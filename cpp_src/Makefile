CXX = g++
CXXFLAGS = -std=c++20 -O3 -Wall -Wextra -pthread -Iinclude
LDFLAGS = -lssl -lcrypto

SRC = src/main.cpp src/reactor.cpp
BACKENDS_SRC = src/backends.cpp
BENCH_SRC = src/benchmarks.cpp

all: aether_proxy backends benchmarks

aether_proxy: $(SRC)
	$(CXX) $(CXXFLAGS) -o $@ $(SRC) $(LDFLAGS)

backends: $(BACKENDS_SRC)
	$(CXX) $(CXXFLAGS) -o $@ $(BACKENDS_SRC)

benchmarks: $(BENCH_SRC)
	$(CXX) $(CXXFLAGS) -o $@ $(BENCH_SRC)

clean:
	rm -f aether_proxy backends benchmarks

.PHONY: all clean
