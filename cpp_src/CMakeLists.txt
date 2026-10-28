cmake_minimum_required(VERSION 3.20)
project(AetherProxy LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -march=native -flto -DNDEBUG")

include_directories(include)

find_package(OpenSSL REQUIRED)
find_package(Threads REQUIRED)

add_executable(aether_proxy
    src/main.cpp
    src/reactor.cpp
)
target_link_libraries(aether_proxy PRIVATE OpenSSL::SSL OpenSSL::Crypto Threads::Threads)

add_executable(backends
    src/backends.cpp
)
target_link_libraries(backends PRIVATE Threads::Threads)

add_executable(benchmarks
    src/benchmarks.cpp
)
target_link_libraries(benchmarks PRIVATE Threads::Threads)
