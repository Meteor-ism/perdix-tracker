This is the PERDIX drone tracker demo for my GenAI class.
# About
When I use `~`, it is relative to the directory of the project, not to the user.

The frontend code is in `~/jrotc-drone-swarm-tracker-2026`.

The backend code is in `~/perdix_tracker`
# How to Run
To run the frontend, `cd` into its directory and run the following command: `npm run dev`. Click or ctrl-click the link to open the web UI.

To run the backend, `cd` into its directory, and run these commands if it's the first time running it:
```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

If it isn't the first time, run the following commands:
```
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

