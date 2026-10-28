/**
 * AetherProxy - High-Performance Memory Arena Allocator
 *
 * Implements:
 * - Bump-pointer and block-pooled memory allocation
 * - Eliminates glibc malloc/free lock contention under high concurrency
 * - Cache-aligned (64-byte boundary) buffer blocks for TCP read/write
 * - O(1) bulk reset per request/session lifecycle
 */

#pragma once

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <vector>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <cstring>

namespace aether {

class ArenaAllocator {
public:
    struct Block {
        char* data = nullptr;
        size_t size = 0;
        size_t capacity = 0;
    };

    explicit ArenaAllocator(size_t chunk_size = 4 * 1024 * 1024, size_t block_size = 16384)
        : chunk_size_(chunk_size), block_size_(block_size) {
        allocate_new_chunk();
    }

    ~ArenaAllocator() {
        for (void* ptr : raw_chunks_) {
            std::free(ptr);
        }
    }

    // Non-copyable, movable
    ArenaAllocator(const ArenaAllocator&) = delete;
    ArenaAllocator& operator=(const ArenaAllocator&) = delete;

    Block acquire_block() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!free_blocks_.empty()) {
            Block b = free_blocks_.back();
            free_blocks_.pop_back();
            b.size = 0;
            return b;
        }

        // Align to 64 bytes
        size_t aligned_offset = (current_offset_ + 63) & ~63;
        if (aligned_offset + block_size_ > chunk_size_) {
            allocate_new_chunk();
            aligned_offset = 0;
        }

        char* ptr = static_cast<char*>(raw_chunks_.back()) + aligned_offset;
        current_offset_ = aligned_offset + block_size_;
        
        allocated_blocks_count_++;
        return Block{ptr, 0, block_size_};
    }

    void release_block(Block& block) {
        if (!block.data) return;
        std::lock_guard<std::mutex> lock(mutex_);
        free_blocks_.push_back(block);
        block.data = nullptr;
        block.size = 0;
    }

    // Reset arena completely (fast bulk release)
    void reset() {
        std::lock_guard<std::mutex> lock(mutex_);
        current_offset_ = 0;
        free_blocks_.clear();
        allocated_blocks_count_ = 0;
    }

    size_t total_memory_bytes() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return raw_chunks_.size() * chunk_size_;
    }

    size_t active_blocks() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return allocated_blocks_count_ - free_blocks_.size();
    }

private:
    size_t chunk_size_;
    size_t block_size_;
    size_t current_offset_ = 0;
    size_t allocated_blocks_count_ = 0;

    std::vector<void*> raw_chunks_;
    std::vector<Block> free_blocks_;
    mutable std::mutex mutex_;

    void allocate_new_chunk() {
        void* mem = nullptr;
        if (posix_memalign(&mem, 64, chunk_size_) != 0) {
            throw std::bad_alloc();
        }
        std::memset(mem, 0, chunk_size_);
        raw_chunks_.push_back(mem);
        current_offset_ = 0;
    }
};

} // namespace aether
