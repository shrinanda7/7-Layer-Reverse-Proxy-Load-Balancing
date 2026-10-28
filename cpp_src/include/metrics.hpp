/**
 * AetherProxy - Prometheus Metrics Exporter & Real-Time Telemetry
 *
 * Implements:
 * - Atomic counters for request rates, status codes (2xx, 4xx, 5xx)
 * - Histogram buckets for p50, p95, p99 latency evaluation
 * - OpenMetrics / Prometheus standard text format generation
 * - Memory and splice() byte counters
 */

#pragma once

#include <string>
#include <sstream>
#include <atomic>
#include <array>
#include <vector>
#include <mutex>
#include <cmath>
#include <algorithm>

namespace aether {

class MetricsRegistry {
public:
    MetricsRegistry() {
        for (auto& b : latency_buckets_) {
            b.store(0);
        }
    }

    void record_request(int status_code, double latency_ms, size_t bytes_transferred, bool used_splice) {
        total_requests_++;
        bytes_transferred_ += bytes_transferred;

        if (status_code >= 200 && status_code < 300) http_2xx_++;
        else if (status_code >= 400 && status_code < 500) http_4xx_++;
        else if (status_code >= 500) http_5xx_++;

        if (used_splice) {
            spliced_requests_++;
            spliced_bytes_ += bytes_transferred;
        }

        // Latency histogram buckets (in ms): [0.5, 1.0, 2.5, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0, +Inf]
        static const double BUCKET_UPPER_BOUNDS[] = {0.5, 1.0, 2.5, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0};
        for (size_t i = 0; i < 11; ++i) {
            if (latency_ms <= BUCKET_UPPER_BOUNDS[i]) {
                latency_buckets_[i]++;
            }
        }
        latency_buckets_[11]++; // +Inf bucket

        // Exponential moving average for live display
        double cur_ema = latency_ema_ms_.load();
        double alpha = 0.05;
        latency_ema_ms_.store((1.0 - alpha) * cur_ema + alpha * latency_ms);
    }

    void connection_opened() {
        current_connections_++;
    }

    void connection_closed() {
        current_connections_--;
    }

    void record_circuit_trip() {
        circuit_trips_total_++;
    }

    void record_rate_limit_drop() {
        rate_limit_drops_total_++;
    }

    // Generate Prometheus / OpenMetrics compatible plain text
    std::string generate_prometheus_text() const {
        std::ostringstream ss;
        ss << "# HELP aether_requests_total Total number of HTTP requests processed by the proxy.\n";
        ss << "# TYPE aether_requests_total counter\n";
        ss << "aether_requests_total " << total_requests_.load() << "\n\n";

        ss << "# HELP aether_http_responses_total Total responses categorized by HTTP status code.\n";
        ss << "# TYPE aether_http_responses_total counter\n";
        ss << "aether_http_responses_total{code=\"2xx\"} " << http_2xx_.load() << "\n";
        ss << "aether_http_responses_total{code=\"4xx\"} " << http_4xx_.load() << "\n";
        ss << "aether_http_responses_total{code=\"5xx\"} " << http_5xx_.load() << "\n\n";

        ss << "# HELP aether_connections_active Number of currently open TCP connections.\n";
        ss << "# TYPE aether_connections_active gauge\n";
        ss << "aether_connections_active " << current_connections_.load() << "\n\n";

        ss << "# HELP aether_splice_transfers_total Zero-copy splice() operations executed.\n";
        ss << "# TYPE aether_splice_transfers_total counter\n";
        ss << "aether_splice_transfers_total " << spliced_requests_.load() << "\n";
        ss << "aether_splice_bytes_total " << spliced_bytes_.load() << "\n\n";

        ss << "# HELP aether_rate_limit_drops_total Dropped requests due to Token Bucket saturation.\n";
        ss << "# TYPE aether_rate_limit_drops_total counter\n";
        ss << "aether_rate_limit_drops_total " << rate_limit_drops_total_.load() << "\n\n";

        ss << "# HELP aether_circuit_breaker_trips_total Times circuit breakers tripped open.\n";
        ss << "# TYPE aether_circuit_breaker_trips_total counter\n";
        ss << "aether_circuit_breaker_trips_total " << circuit_trips_total_.load() << "\n\n";

        ss << "# HELP aether_request_duration_ms Request latency histogram in milliseconds.\n";
        ss << "# TYPE aether_request_duration_ms histogram\n";
        static const char* BUCKET_NAMES[] = {"0.5", "1.0", "2.5", "5.0", "10.0", "25.0", "50.0", "100.0", "250.0", "500.0", "1000.0", "+Inf"};
        for (size_t i = 0; i < 12; ++i) {
            ss << "aether_request_duration_ms_bucket{le=\"" << BUCKET_NAMES[i] << "\"} " << latency_buckets_[i].load() << "\n";
        }
        return ss.str();
    }

    uint64_t get_total_requests() const { return total_requests_.load(); }
    uint64_t get_http_2xx() const { return http_2xx_.load(); }
    uint64_t get_http_5xx() const { return http_5xx_.load(); }
    int64_t get_active_connections() const { return current_connections_.load(); }
    double get_latency_ema() const { return latency_ema_ms_.load(); }
    uint64_t get_spliced_requests() const { return spliced_requests_.load(); }
    uint64_t get_rate_limit_drops() const { return rate_limit_drops_total_.load(); }
    uint64_t get_circuit_trips() const { return circuit_trips_total_.load(); }

private:
    std::atomic<uint64_t> total_requests_{0};
    std::atomic<uint64_t> http_2xx_{0};
    std::atomic<uint64_t> http_4xx_{0};
    std::atomic<uint64_t> http_5xx_{0};
    std::atomic<int64_t> current_connections_{0};
    std::atomic<uint64_t> bytes_transferred_{0};
    std::atomic<uint64_t> spliced_requests_{0};
    std::atomic<uint64_t> spliced_bytes_{0};
    std::atomic<uint64_t> rate_limit_drops_total_{0};
    std::atomic<uint64_t> circuit_trips_total_{0};
    std::atomic<double> latency_ema_ms_{1.2};
    std::array<std::atomic<uint64_t>, 12> latency_buckets_;
};

} // namespace aether
