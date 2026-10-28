/**
 * AetherProxy - High-Performance C++ Reverse Proxy Core
 *
 * Implements:
 * - Multi-Reactor Event-Loop pattern with epoll and SO_REUSEPORT
 * - Zero-copy stream relaying using Linux splice() system call
 * - Non-blocking TCP socket I/O (edge-triggered epoll)
 * - HTTP/1.1 parsing, header forwarding (X-Forwarded-For, Via)
 * - OpenSSL TLS termination & SNI-based TLS passthrough
 * - WebSocket upgrade handshake and bi-directional frame tunneling
 */

#pragma once

#include <string>
#include <vector>
#include <memory>
#include <thread>
#include <atomic>
#include <functional>
#include <unordered_map>
#include <chrono>
#include <sys/epoll.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <unistd.h>
#include <openssl/ssl.h>
#include <openssl/err.h>

#include "load_balancer.hpp"
#include "token_bucket.hpp"
#include "circuit_breaker.hpp"
#include "memory_arena.hpp"
#include "metrics.hpp"

namespace aether {

struct ProxyConfig {
    std::string listen_host = "0.0.0.0";
    uint16_t listen_port = 8080;
    uint16_t tls_port = 8443;
    bool tls_enabled = false;
    std::string tls_cert_path = "certs/server.crt";
    std::string tls_key_path = "certs/server.key";
    
    size_t worker_threads = 4;
    size_t max_events = 1024;
    size_t buffer_size = 16384;
    bool enable_splice = true; // Use splice() zero-copy for streaming
    
    // Protection
    double rate_limit_rps = 1000.0;
    size_t rate_limit_burst = 200;
    double cb_failure_rate_threshold = 0.5;
    uint32_t cb_open_timeout_ms = 5000;
    
    std::vector<BackendConfig> backends = {
        {"127.0.0.1", 8081, 1, "backend-alpha"},
        {"127.0.0.1", 8082, 1, "backend-beta"}
    };
    
    LoadBalanceAlgorithm lb_algo = LoadBalanceAlgorithm::LEAST_CONNECTIONS;
};

// Represents an active client-to-backend proxy session
struct ConnectionSession {
    int client_fd = -1;
    int backend_fd = -1;
    int pipe_fds[2] = {-1, -1}; // Pipe pair for zero-copy splice()
    
    SSL* ssl = nullptr;
    std::string client_ip;
    std::string current_backend_id;
    bool is_websocket = false;
    bool is_tls = false;
    bool is_splicing = false;
    
    std::chrono::steady_clock::time_point start_time;
    ArenaAllocator::Block client_buffer;
    ArenaAllocator::Block backend_buffer;
};

class ReactorWorker {
public:
    ReactorWorker(int worker_id, const ProxyConfig& config,
                  std::shared_ptr<LoadBalancer> lb,
                  std::shared_ptr<TokenBucketLimiter> limiter,
                  std::shared_ptr<MetricsRegistry> metrics);
    ~ReactorWorker();

    void start();
    void stop();
    void reload_config(const ProxyConfig& new_config);

private:
    int worker_id_;
    ProxyConfig config_;
    std::shared_ptr<LoadBalancer> lb_;
    std::shared_ptr<TokenBucketLimiter> limiter_;
    std::shared_ptr<MetricsRegistry> metrics_;
    
    int epoll_fd_ = -1;
    int listen_fd_ = -1;
    int tls_listen_fd_ = -1;
    SSL_CTX* ssl_ctx_ = nullptr;
    std::atomic<bool> running_{false};
    std::thread thread_;
    
    // Per-worker arena to prevent heap fragmentation across epoll loops
    std::unique_ptr<ArenaAllocator> worker_arena_;
    std::unordered_map<int, std::shared_ptr<ConnectionSession>> sessions_;

    void init_socket(int port, int& out_fd);
    void init_tls();
    void event_loop();
    void handle_new_connection(int listen_fd, bool is_tls);
    void handle_client_data(int fd);
    void handle_backend_data(int fd);
    bool execute_zero_copy_splice(ConnectionSession& session);
    void close_session(int fd);
    
    static int set_non_blocking(int fd);
};

class ReverseProxyServer {
public:
    explicit ReverseProxyServer(const ProxyConfig& config);
    ~ReverseProxyServer();

    void start();
    void stop();
    void handle_sighup(); // Safe atomic configuration reload

    std::shared_ptr<MetricsRegistry> get_metrics() const { return metrics_; }
    std::shared_ptr<LoadBalancer> get_load_balancer() const { return lb_; }

private:
    ProxyConfig config_;
    std::atomic<bool> running_{false};
    std::shared_ptr<MetricsRegistry> metrics_;
    std::shared_ptr<LoadBalancer> lb_;
    std::shared_ptr<TokenBucketLimiter> limiter_;
    std::vector<std::unique_ptr<ReactorWorker>> workers_;
};

} // namespace aether
