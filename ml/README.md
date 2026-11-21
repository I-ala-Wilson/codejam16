# ml/: gesture classifier

Everything runs with `ml/.venv/bin/python` from the repo root. Training uses the GPU only (it refuses to fall back to the CPU).
Method and data protocol: `ml/PROTOCOL.md`. Numbers: `ml/REPORT.md`, `ml/experiments/RESULTS.md`.

    ml/.venv/bin/python ml/run.py lopo  data/recordings     # leave-one-person-out report
    ml/.venv/bin/python ml/run.py final data/recordings     # train on everyone, write ml/models/gesture.onnx + gesture.json

## Demo-day calibration (one command, about 3 minutes on the GPU laptop: 3 min 3 s measured with 178 takes)

The person who will present records a few extra takes on the demo laptop; the model then counts those takes 5 times.

1. Open the app on the demo laptop, go to the **Dataset recording** tab and record about 5 cues per gesture (PUSH, PULL, WAVE,
   OPEN_CLOSE, UNDO) with the usual battery settings, plus one NONE take. Same room, laptop and volume as the demo.
2. Move the downloaded `.json` + `.wav` pairs into `data/recordings/<login>/calib-1/` (any folder name starting with `calib-` works,
   for example `calib-2` for a second round). The `<login>` folder is your GitHub login as in the other recordings.
3. Audit the takes (every take must say PASS or WARN; a FAIL means record that take again):

       ml/.venv/bin/python ml/audit.py data/recordings/<login>/calib-1

4. Retrain (the command audits the calibration takes again and stops with exit code 1 if one FAILS). `--person` must equal the
   name typed in the Dataset tab's name box, which is stored as the `person` field of the `.json` (case does not matter; Ian's
   gesture takes say `i-ala-wilson`; check with `grep '"person"' data/recordings/<login>/calib-1/*.json | sort -u`):

       ml/.venv/bin/python ml/run.py calib data/recordings --person <login> --out-dir /tmp/calib-out

   Options: `--repeat 5` (how many times the calibration takes count in training), `--epochs 30`, `--seed 0`. It prints the number
   of calibration takes and cues, the cues per class, the training windows, the training time and the output paths.
5. KEEP THE CURRENT MODEL FIRST so you can roll back in seconds (a retrained model once misread WAVE as UNDO live, see
   `ml/experiments/RESULTS.md`): `cp app/public/models/gesture.onnx /tmp/gesture.prev.onnx` and the same for `gesture.json`.
   Then copy the result over the shipped model (the app serves `app/public/models/`):

       cp /tmp/calib-out/gesture.onnx /tmp/calib-out/gesture.json ml/models/
       cp /tmp/calib-out/gesture.onnx /tmp/calib-out/gesture.json app/public/models/

   (Without `--out-dir` the command writes straight into `ml/models/`.)
6. Reload the page in the browser (hard reload so the new `gesture.onnx` is fetched) and TRY EACH GESTURE LIVE before relying on
   it: WAVE 5 times (it must not turn into UNDO), UNDO 5 times, PUSH and PULL 5 times each. If anything is worse than before,
   copy `/tmp/gesture.prev.onnx` and `/tmp/gesture.prev.json` back over `app/public/models/` and reload.

All takes under `data/recordings` are used, not only the calibration ones; only that person's `calib-*` takes are repeated.
