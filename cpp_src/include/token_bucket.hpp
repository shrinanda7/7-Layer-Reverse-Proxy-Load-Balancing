/**
 * AetherProxy - Per-IP Token Bucket Rate Limiter
 *
 * Implements:
 * - High-concurrency token bucket rate limiting
 * - Continuous refill based on high-resolution clock
 * - Lock-striped / sharded map for per-IP bucket states
 * - Burst allowance with hard capacity capping
 */

#pragma once

#include <string>
#include <unordered_map>
#include <mutex>
#include <chrono>
#include <atomic>

namespace aether {

class TokenBucketLimiter {
public:
    TokenBucketLimiter(double tokens_per_second, size_t burst_capacity)
        : default_rate_(tokens_per_second), default_capacity_(static_cast<double>(burst_capacity)) {}

    // Returns true if request is allowed, false if dropped (HTTP 429 Too Many Requests)
    bool allow_request(const std::string& client_ip, double cost = 1.0) {
        size_t shard = std::hash<std::string>{}(client_ip) % NUM_SHARDS;
        std::lock_guard<std::mutex> lock(shard_mutexes_[shard]);
        
        auto now = std::chrono::steady_clock::now();
        auto& bucket = shard_buckets_[shard][client_ip];
        
        if (bucket.last_refill == std::chrono::steady_clock::time_point{}) {
            bucket.tokens = default_capacity_;
            bucket.last_refill = now;
        } else {
            std::chrono::duration<double> elapsed = now - bucket.last_refill;
            bucket.tokens = std::min(default_capacity_, bucket.tokens + elapsed.count() * default_rate_);
            bucket.last_refill = now;
        }

        if (bucket.tokens >= cost) {
            bucket.tokens -= cost;
            return true;
        }
        return false;
    }

    void update_limits(double tokens_per_second, size_t burst_capacity) {
        default_rate_ = tokens_per_second;
        default_capacity_ = static_cast<double>(burst_capacity);
    }

    double get_rate() const { return default_rate_; }
    double get_capacity() const { return default_capacity_; }

private:
    struct Bucket {
        double tokens = 0.0;
        std::chrono::steady_clock::time_point last_refill;
    };

    static constexpr size_t NUM_SHARDS = 32;
    std::mutex shard_mutexes_[NUM_SHARDS];
    std::unordered_map<std::string, Bucket> shard_buckets_[NUM_SHARDS];
    
    double default_rate_;
    double default_capacity_;
};

} // namespace aether
