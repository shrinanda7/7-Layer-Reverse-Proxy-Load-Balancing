/**
 * AetherProxy - Controlled Management Interface & Safe Configuration Publisher
 *
 * Implements:
 * - Controlled control plane interface for proxy settings updates
 * - Validates schema, constraints, and invariants prior to applying changes
 * - Safe atomic snapshot publishing across worker threads (RCU-style pointer swap)
 * - Emits audit logs and metrics on configuration reloads
 */

#pragma once

#include <string>
#include <memory>
#include <mutex>
#include <atomic>
#include <vector>
#include <functional>
#include <chrono>

namespace aether {

struct ProxyConfig; // Forward declaration

struct ValidationResult {
    bool valid = true;
    std::string error_message;
};

struct ManagementAuditLog {
    std::string timestamp;
    std::string action;
    std::string details;
    bool success;
};

class ProxyManagementPlane {
public:
    using ConfigPublishCallback = std::function<void(const ProxyConfig& new_config)>;

    static ValidationResult validate_config(const ProxyConfig& cfg);

    ProxyManagementPlane();
    void register_publish_callback(ConfigPublishCallback cb);

    // Controlled mutation entry point
    ValidationResult update_configuration(const ProxyConfig& proposed_config, const std::string& actor = "admin_api");

    std::vector<ManagementAuditLog> get_audit_trail() const;

private:
    std::mutex management_mutex_;
    ConfigPublishCallback publish_callback_;
    std::vector<ManagementAuditLog> audit_logs_;
};

} // namespace aether
