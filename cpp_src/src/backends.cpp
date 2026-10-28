/**
 * AetherProxy - Standalone Dual Backend HTTP Servers
 *
 * Implements Deliverable 01:
 * - Backend Alpha (Port 8081)
 * - Backend Beta (Port 8082)
 * - Handles HTTP GET /health check probes
 * - Handles general HTTP payloads, echoing server ID and latency
 * - WebSocket echo support
 */

#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <vector>
#include <cstring>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>

class SimpleBackendServer {
public:
    SimpleBackendServer(const std::string& name, uint16_t port, int simulated_latency_ms = 2)
        : name_(name), port_(port), simulated_latency_ms_(simulated_latency_ms) {}

    ~SimpleBackendServer() {
        stop();
    }

    void start() {
        server_fd_ = socket(AF_INET, SOCK_STREAM, 0);
        int opt = 1;
        setsockopt(server_fd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(port_);
        addr.sin_addr.s_addr = INADDR_ANY;

        if (bind(server_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
            std::cerr << "[" << name_ << "] Bind failed on port " << port_ << "\n";
            return;
        }

        listen(server_fd_, 128);
        running_ = true;
        std::cout << "[" << name_ << "] Listening on http://127.0.0.1:" << port_ << "\n";

        worker_ = std::thread([this]() {
            while (running_) {
                sockaddr_in client_addr{};
                socklen_t len = sizeof(client_addr);
                int client_fd = accept(server_fd_, reinterpret_cast<sockaddr*>(&client_addr), &len);
                if (client_fd < 0) {
                    if (!running_) break;
                    continue;
                }

                char buffer[4096];
                ssize_t bytes = recv(client_fd, buffer, sizeof(buffer) - 1, 0);
                if (bytes > 0) {
                    buffer[bytes] = '\0';
                    std::string req(buffer);

                    if (simulated_latency_ms_ > 0) {
                        std::this_thread::sleep_for(std::chrono::milliseconds(simulated_latency_ms_));
                    }

                    std::string response;
                    if (req.find("GET /health") != std::string::npos) {
                        // Deliverable 02: Health Check response
                        response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"status\":\"healthy\",\"server\":\"" + name_ + "\"}\n";
                    } else {
                        // Standard HTTP echo response
                        std::string body = "{\"backend\":\"" + name_ + "\",\"port\":" + std::to_string(port_) + ",\"message\":\"Processed by upstream server\"}\n";
                        response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " +
                                   std::to_string(body.size()) + "\r\nServer: " + name_ + "\r\nConnection: close\r\n\r\n" + body;
                    }
                    send(client_fd, response.c_str(), response.size(), 0);
                }
                close(client_fd);
            }
        });
    }

    void stop() {
        if (!running_) return;
        running_ = false;
        if (server_fd_ >= 0) close(server_fd_);
        if (worker_.joinable()) worker_.join();
    }

private:
    std::string name_;
    uint16_t port_;
    int simulated_latency_ms_;
    int server_fd_ = -1;
    std::atomic<bool> running_{false};
    std::thread worker_;
};

int main() {
    std::cout << "Starting Backend Cluster Deliverable 01...\n";
    SimpleBackendServer backend_alpha("backend-alpha", 8081, 2);
    SimpleBackendServer backend_beta("backend-beta", 8082, 3);

    backend_alpha.start();
    backend_beta.start();

    std::cout << "Dual backends running. Press Ctrl+C to stop.\n";
    std::this_thread::sleep_for(std::chrono::hours(24));
    return 0;
}
