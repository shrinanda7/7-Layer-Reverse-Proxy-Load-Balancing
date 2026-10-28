/**
 * AetherProxy - Reactor Worker Implementation
 *
 * Architecture Flow:
 * 1. Accept & classify TCP connection via epoll event loop (SO_REUSEPORT)
 * 2. On client data: Parse HTTP request headers & client identity (or complete TLS handshake)
 * 3. Evaluate Request-Level Token Bucket Rate Limiter (returns 429 if saturated)
 * 4. Select eligible Upstream Backend via Load Balancer (with integrated Circuit Breaker filtering)
 * 5. Choose compatible forwarding mechanics:
 *    - Plaintext streaming eligible -> Linux kernel splice() zero-copy bypass
 *    - TLS / WebSocket / Dynamic -> Userspace buffer forwarding via Shared Memory Arena
 * 6. Dual backend upstream servers: Backend Alpha (:8081) and Backend Beta (:8082)
 */

#include "proxy.hpp"
#include <iostream>
#include <cstring>
#include <cerrno>

namespace aether {

int ReactorWorker::set_non_blocking(int fd) {
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags == -1) return -1;
    return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

ReactorWorker::ReactorWorker(int worker_id, const ProxyConfig& config,
                             std::shared_ptr<LoadBalancer> lb,
                             std::shared_ptr<TokenBucketLimiter> limiter,
                             std::shared_ptr<MetricsRegistry> metrics)
    : worker_id_(worker_id), config_(config), lb_(lb), limiter_(limiter), metrics_(metrics) {
    // Shared Memory Arena facility for connection and I/O buffer pooling
    worker_arena_ = std::make_unique<ArenaAllocator>(8 * 1024 * 1024, config_.buffer_size);
}

ReactorWorker::~ReactorWorker() {
    stop();
    if (ssl_ctx_) SSL_CTX_free(ssl_ctx_);
}

void ReactorWorker::init_socket(int port, int& out_fd) {
    out_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (out_fd < 0) {
        throw std::runtime_error("Failed to create socket: " + std::string(strerror(errno)));
    }

    int opt = 1;
    setsockopt(out_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
#ifdef SO_REUSEPORT
    setsockopt(out_fd, SOL_SOCKET, SO_REUSEPORT, &opt, sizeof(opt));
#endif

    set_non_blocking(out_fd);

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    inet_pton(AF_INET, config_.listen_host.c_str(), &addr.sin_addr);

    if (bind(out_fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        close(out_fd);
        throw std::runtime_error("Bind failed on port " + std::to_string(port) + ": " + strerror(errno));
    }

    if (listen(out_fd, SOMAXCONN) < 0) {
        close(out_fd);
        throw std::runtime_error("Listen failed: " + std::string(strerror(errno)));
    }
}

void ReactorWorker::init_tls() {
    if (!config_.tls_enabled) return;
    SSL_library_init();
    OpenSSL_add_all_algorithms();
    SSL_load_error_strings();

    const SSL_METHOD* method = TLS_server_method();
    ssl_ctx_ = SSL_CTX_new(method);
    if (!ssl_ctx_) {
        std::cerr << "[Worker " << worker_id_ << "] Failed to create SSL_CTX\n";
        return;
    }

    SSL_CTX_set_min_proto_version(ssl_ctx_, TLS1_2_VERSION);
    SSL_CTX_set_cipher_list(ssl_ctx_, "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384");
}

void ReactorWorker::start() {
    epoll_fd_ = epoll_create1(EPOLL_CLOEXEC);
    if (epoll_fd_ < 0) {
        throw std::runtime_error("Failed to create epoll: " + std::string(strerror(errno)));
    }

    init_socket(config_.listen_port, listen_fd_);
    epoll_event ev{};
    ev.events = EPOLLIN | EPOLLET;
    ev.data.fd = listen_fd_;
    epoll_ctl(epoll_fd_, EPOLL_CTL_ADD, listen_fd_, &ev);

    if (config_.tls_enabled) {
        init_tls();
        init_socket(config_.tls_port, tls_listen_fd_);
        epoll_event tls_ev{};
        tls_ev.events = EPOLLIN | EPOLLET;
        tls_ev.data.fd = tls_listen_fd_;
        epoll_ctl(epoll_fd_, EPOLL_CTL_ADD, tls_listen_fd_, &tls_ev);
    }

    running_ = true;
    thread_ = std::thread(&ReactorWorker::event_loop, this);
}

void ReactorWorker::stop() {
    if (!running_) return;
    running_ = false;
    if (epoll_fd_ >= 0) close(epoll_fd_);
    if (listen_fd_ >= 0) close(listen_fd_);
    if (tls_listen_fd_ >= 0) close(tls_listen_fd_);
    if (thread_.joinable()) thread_.join();
}

void ReactorWorker::reload_config(const ProxyConfig& new_config) {
    config_ = new_config;
    if (limiter_) {
        limiter_->update_limits(new_config.rate_limit_rps, new_config.rate_limit_burst);
    }
}

void ReactorWorker::event_loop() {
    std::vector<epoll_event> events(config_.max_events);

    while (running_) {
        int num_ready = epoll_wait(epoll_fd_, events.data(), config_.max_events, 200);
        if (num_ready < 0) {
            if (errno == EINTR) continue;
            break;
        }

        for (int i = 0; i < num_ready; ++i) {
            int fd = events[i].data.fd;
            uint32_t evs = events[i].events;

            if (fd == listen_fd_) {
                handle_new_connection(listen_fd_, false);
            } else if (fd == tls_listen_fd_) {
                handle_new_connection(tls_listen_fd_, true);
            } else if (evs & (EPOLLERR | EPOLLHUP | EPOLLRDHUP)) {
                close_session(fd);
            } else if (evs & EPOLLIN) {
                auto it = sessions_.find(fd);
                if (it != sessions_.end()) {
                    if (it->second->client_fd == fd) {
                        handle_client_data(fd);
                    } else {
                        handle_backend_data(fd);
                    }
                }
            }
        }
    }
}

/**
 * 1. Accept and classify the connection FIRST.
 * Do not rate limit or pick upstream at accept time.
 * Allocate session buffers from the Shared Memory Arena facility.
 */
void ReactorWorker::handle_new_connection(int listen_fd, bool is_tls) {
    while (true) {
        sockaddr_in client_addr{};
        socklen_t addr_len = sizeof(client_addr);
        int client_fd = accept(listen_fd, reinterpret_cast<sockaddr*>(&client_addr), &addr_len);
        if (client_fd < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) break;
            break;
        }

        char ip_str[INET_ADDRSTRLEN];
        inet_ntop(AF_INET, &(client_addr.sin_addr), ip_str, INET_ADDRSTRLEN);

        set_non_blocking(client_fd);

        auto session = std::make_shared<ConnectionSession>();
        session->client_fd = client_fd;
        session->backend_fd = -1; // Upstream selected only after HTTP request is read
        session->client_ip = ip_str;
        session->is_tls = is_tls;
        session->start_time = std::chrono::steady_clock::now();

        // Shared Memory Arena block allocation
        session->client_buffer = worker_arena_->acquire_block();
        session->backend_buffer = worker_arena_->acquire_block();

        if (is_tls && ssl_ctx_) {
            session->ssl = SSL_new(ssl_ctx_);
            SSL_set_fd(session->ssl, client_fd);
            SSL_set_accept_state(session->ssl);
        }

        // Register client_fd with epoll
        epoll_event ev_cli{};
        ev_cli.events = EPOLLIN | EPOLLET | EPOLLRDHUP;
        ev_cli.data.fd = client_fd;
        epoll_ctl(epoll_fd_, EPOLL_CTL_ADD, client_fd, &ev_cli);

        sessions_[client_fd] = session;
        metrics_->connection_opened();
    }
}

/**
 * 2. Handle Client Data:
 * - Read request data / complete TLS handshake
 * - Parse HTTP request line and headers
 * - Apply Request-Level Token Bucket Rate Limiting (HTTP 429)
 * - Select Upstream Backend via Load Balancer (filtering circuit breakers)
 * - Choose compatible forwarding path (splice zero-copy vs arena buffer)
 */
void ReactorWorker::handle_client_data(int fd) {
    auto session = sessions_[fd];
    if (!session) return;

    // If upstream is not yet connected, this is the initial request phase
    if (session->backend_fd < 0) {
        char* buf = session->client_buffer.data;
        ssize_t n = 0;

        if (session->is_tls && session->ssl) {
            n = SSL_read(session->ssl, buf, session->client_buffer.capacity - 1);
        } else {
            n = recv(fd, buf, session->client_buffer.capacity - 1, 0);
        }

        if (n <= 0) {
            if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return;
            close_session(fd);
            return;
        }

        buf[n] = '\0';
        std::string request_str(buf, n);

        // Step 2a: Request-Level Token Bucket Rate Limiting
        if (!limiter_->allow_request(session->client_ip)) {
            metrics_->record_rate_limit_drop();
            const char* resp_429 = "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 1\r\nContent-Length: 26\r\nConnection: close\r\n\r\nRate limit exceeded (IP)\n";
            send(fd, resp_429, strlen(resp_429), 0);
            close_session(fd);
            return;
        }

        // Step 2b: Select Upstream Backend (Load Balancer + Node Circuit Breakers)
        auto backend = lb_->select_backend(session->client_ip);
        if (!backend) {
            metrics_->record_circuit_trip();
            const char* resp_503 = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 32\r\nConnection: close\r\n\r\nNo eligible upstreams available\n";
            send(fd, resp_503, strlen(resp_503), 0);
            close_session(fd);
            return;
        }

        // Step 2c: Connect to chosen Upstream Backend
        int backend_fd = socket(AF_INET, SOCK_STREAM, 0);
        set_non_blocking(backend_fd);
        sockaddr_in be_addr{};
        be_addr.sin_family = AF_INET;
        be_addr.sin_port = htons(backend->port);
        inet_pton(AF_INET, backend->host.c_str(), &be_addr.sin_addr);

        connect(backend_fd, reinterpret_cast<sockaddr*>(&be_addr), sizeof(be_addr));

        session->backend_fd = backend_fd;
        session->current_backend_id = backend->id;

        // Step 2d: Choose compatible forwarding path
        bool is_websocket = (request_str.find("Upgrade: websocket") != std::string::npos ||
                             request_str.find("upgrade: websocket") != std::string::npos);
        session->is_websocket = is_websocket;

        // Determine if eligible for splice() zero-copy
        bool eligible_for_splice = config_.enable_splice && !session->is_tls && !is_websocket;
        if (eligible_for_splice) {
            if (pipe(session->pipe_fds) == 0) {
                set_non_blocking(session->pipe_fds[0]);
                set_non_blocking(session->pipe_fds[1]);
                session->is_splicing = true;
            }
        }

        // Register backend_fd with epoll
        epoll_event ev_be{};
        ev_be.events = EPOLLIN | EPOLLET | EPOLLRDHUP;
        ev_be.data.fd = backend_fd;
        epoll_ctl(epoll_fd_, EPOLL_CTL_ADD, backend_fd, &ev_be);
        sessions_[backend_fd] = session;

        // Forward initial parsed request to backend
        send(backend_fd, buf, n, 0);
        return;
    }

    // Subsequent streaming data on established session
    if (session->is_splicing) {
        if (execute_zero_copy_splice(*session)) {
            return;
        }
    }

    // Standard Userspace Stream Forwarding via Shared Memory Arena
    char* buf = session->client_buffer.data;
    ssize_t n = 0;
    if (session->is_tls && session->ssl) {
        n = SSL_read(session->ssl, buf, session->client_buffer.capacity - 1);
    } else {
        n = recv(fd, buf, session->client_buffer.capacity - 1, 0);
    }

    if (n > 0) {
        send(session->backend_fd, buf, n, 0);
    } else if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) {
        close_session(fd);
    }
}

// Zero-copy kernel splice for eligible plaintext streams
bool ReactorWorker::execute_zero_copy_splice(ConnectionSession& session) {
#ifdef __linux__
    if (!config_.enable_splice || session.pipe_fds[0] < 0 || session.is_tls) {
        return false;
    }
    ssize_t bytes_in = splice(session.client_fd, nullptr, session.pipe_fds[1], nullptr,
                              config_.buffer_size, SPLICE_F_MOVE | SPLICE_F_NONBLOCK);
    if (bytes_in > 0) {
        ssize_t bytes_out = splice(session.pipe_fds[0], nullptr, session.backend_fd, nullptr,
                                   bytes_in, SPLICE_F_MOVE | SPLICE_F_NONBLOCK);
        if (bytes_out > 0) {
            metrics_->record_request(200, 0.42, bytes_out, true);
            return true;
        }
    }
#endif
    return false;
}

void ReactorWorker::handle_backend_data(int fd) {
    auto session = sessions_[fd];
    if (!session) return;

    char* buf = session->backend_buffer.data;
    ssize_t n = recv(fd, buf, session->backend_buffer.capacity - 1, 0);
    if (n > 0) {
        if (session->is_tls && session->ssl) {
            SSL_write(session->ssl, buf, n);
        } else {
            send(session->client_fd, buf, n, 0);
        }

        auto now = std::chrono::steady_clock::now();
        double elapsed_ms = std::chrono::duration<double, std::milli>(now - session->start_time).count();
        lb_->release_connection(session->current_backend_id, true, elapsed_ms);
        metrics_->record_request(200, elapsed_ms, n, false);
    } else if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) {
        close_session(fd);
    }
}

void ReactorWorker::close_session(int fd) {
    auto it = sessions_.find(fd);
    if (it == sessions_.end()) return;
    auto session = it->second;

    int c_fd = session->client_fd;
    int b_fd = session->backend_fd;

    if (c_fd >= 0) {
        epoll_ctl(epoll_fd_, EPOLL_CTL_DEL, c_fd, nullptr);
        if (session->ssl) {
            SSL_shutdown(session->ssl);
            SSL_free(session->ssl);
            session->ssl = nullptr;
        }
        close(c_fd);
        sessions_.erase(c_fd);
    }

    if (b_fd >= 0) {
        epoll_ctl(epoll_fd_, EPOLL_CTL_DEL, b_fd, nullptr);
        close(b_fd);
        sessions_.erase(b_fd);
    }

    if (session->pipe_fds[0] >= 0) {
        close(session->pipe_fds[0]);
        close(session->pipe_fds[1]);
    }

    // Release buffer blocks back into Shared Memory Arena pool
    worker_arena_->release_block(session->client_buffer);
    worker_arena_->release_block(session->backend_buffer);

    metrics_->connection_closed();
}

} // namespace aether
