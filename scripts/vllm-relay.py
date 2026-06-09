"""User-mode TCP relay from Docker's Windows host to the remote vLLM server.

Run this on Windows when Docker cannot route directly to the GPU host:

    python scripts/vllm-relay.py

Then set backend/.env:

    VLLM_BASE_URL=http://host.docker.internal:8001
"""
from __future__ import annotations

import argparse
import select
import socket
import threading


def pipe(source: socket.socket, target: socket.socket) -> None:
    try:
        while True:
            readable, _, _ = select.select([source], [], [], 60)
            if not readable:
                continue
            data = source.recv(65536)
            if not data:
                return
            target.sendall(data)
    except OSError:
        return
    finally:
        try:
            target.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def handle_client(client: socket.socket, target_host: str, target_port: int) -> None:
    with client:
        try:
            upstream = socket.create_connection((target_host, target_port), timeout=10)
        except OSError as exc:
            print(f"[relay] failed to connect to {target_host}:{target_port}: {exc}", flush=True)
            return

        with upstream:
            left = threading.Thread(target=pipe, args=(client, upstream), daemon=True)
            right = threading.Thread(target=pipe, args=(upstream, client), daemon=True)
            left.start()
            right.start()
            left.join()
            right.join()


def main() -> None:
    parser = argparse.ArgumentParser(description="Forward local TCP traffic to vLLM.")
    parser.add_argument("--listen-host", default="0.0.0.0")
    parser.add_argument("--listen-port", type=int, default=8001)
    parser.add_argument("--target-host", default="172.20.7.22")
    parser.add_argument("--target-port", type=int, default=8000)
    args = parser.parse_args()

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((args.listen_host, args.listen_port))
        server.listen(128)
        print(
            "[relay] listening on "
            f"{args.listen_host}:{args.listen_port} -> {args.target_host}:{args.target_port}",
            flush=True,
        )
        while True:
            client, address = server.accept()
            print(f"[relay] connection from {address[0]}:{address[1]}", flush=True)
            threading.Thread(
                target=handle_client,
                args=(client, args.target_host, args.target_port),
                daemon=True,
            ).start()


if __name__ == "__main__":
    main()
