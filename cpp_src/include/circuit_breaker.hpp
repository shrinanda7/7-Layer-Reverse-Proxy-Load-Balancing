/**
 * AetherProxy - Upstream Circuit Breaker
 *
 * Implements:
 * - 3-State Machine: CLOSED (Normal), OPEN (Failing/Tripped), HALF_OPEN (Testing recovery)
 * - Rolling statistical window for failure percentages
 * - Automatic isolation of failing backends
 * - Cooldown backoff before testing half-open recovery
 */

#pragma once

#include <atomic>
#include <mutex>
#include <chrono>
#include <string>

namespace aether {

enum class CircuitState {
    CLOSED,    // Requests pass through normally
    OPEN,      // Tripped: immediate 503 Service Unavailable / fast fallback
    HALF_OPEN  // Testing single probe requests to gauge upstream recovery
};

inline const char* to_string(CircuitState state) {
    switch (state) {
        case CircuitState::CLOSED: return "CLOSED";
        case CircuitState::OPEN: return "OPEN";
        case CircuitState::HALF_OPEN: return "HALF_OPEN";
        default: return "UNKNOWN";
    }
}

class CircuitBreaker {
public:
    CircuitBreaker(double failure_threshold = 0.5,
                   uint32_t open_cooldown_ms = 5000,
                   uint32_t min_requests = 10,
                   uint32_t half_open_success_needed = 3)
        : failure_threshold_(failure_threshold),
          open_cooldown_ms_(open_cooldown_ms),
          min_requests_(min_requests),
          half_open_success_needed_(half_open_success_needed) {}

    // Check if a request can be dispatched
    bool allow_request() {
        std::lock_guard<std::mutex> lock(mutex_);
        auto now = std::chrono::steady_clock::now();

        if (state_ == CircuitState::OPEN) {
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_state_change_).count();
            if (elapsed >= open_cooldown_ms_) {
                state_ = CircuitState::HALF_OPEN;
                last_state_change_ = now;
                half_open_successes_ = 0;
                return true; // Allow probe request
            }
            return false; // Fast-fail
        }

        if (state_ == CircuitState::HALF_OPEN) {
            // In half-open, only admit one probe request at a time
            return (half_open_successes_ < half_open_success_needed_);
        }

        return true; // CLOSED state
    }

    void record_result(bool success) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto now = std::chrono::steady_clock::now();

        if (state_ == CircuitState::HALF_OPEN) {
            if (success) {
                half_open_successes_++;
                if (half_open_successes_ >= half_open_success_needed_) {
                    state_ = CircuitState::CLOSED;
                    last_state_change_ = now;
                    reset_counters();
                }
            } else {
                state_ = CircuitState::OPEN;
                last_state_change_ = now;
                half_open_successes_ = 0;
            }
            return;
        }

        if (state_ == CircuitState::CLOSED) {
            window_requests_++;
            if (!success) {
                window_failures_++;
            }

            if (window_requests_ >= min_requests_) {
                double failure_rate = static_cast<double>(window_failures_) / window_requests_;
                if (failure_rate >= failure_threshold_) {
                    state_ = CircuitState::OPEN;
                    last_state_change_ = now;
                } else if (window_requests_ >= 100) {
                    reset_counters();
                }
            }
        }
    }

    CircuitState get_state() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return state_;
    }

    void trip_manually() {
        std::lock_guard<std::mutex> lock(mutex_);
        state_ = CircuitState::OPEN;
        last_state_change_ = std::chrono::steady_clock::now();
    }

    void reset_manually() {
        std::lock_guard<std::mutex> lock(mutex_);
        state_ = CircuitState::CLOSED;
        last_state_change_ = std::chrono::steady_clock::now();
        reset_counters();
    }

private:
    double failure_threshold_;
    uint32_t open_cooldown_ms_;
    uint32_t min_requests_;
    uint32_t half_open_success_needed_;

    mutable std::mutex mutex_;
    CircuitState state_{CircuitState::CLOSED};
    std::chrono::steady_clock::time_point last_state_change_{std::chrono::steady_clock::now()};

    uint32_t window_requests_{0};
    uint32_t window_failures_{0};
    uint32_t half_open_successes_{0};

    void reset_counters() {
        window_requests_ = 0;
        window_failures_ = 0;
    }
};

} // namespace aether
