import asyncio
import json

import websockets


async def main():
    uri = "ws://localhost:8000/ws/tracks"
    async with websockets.connect(uri, max_size=5_000_000) as ws:
        while True:
            msg = await ws.recv()
            data = json.loads(msg)
            print(data.get("type"), "frame", data.get("frame_idx"))
            if data.get("type") in ("eof", "error"):
                break


if __name__ == "__main__":
    asyncio.run(main())
