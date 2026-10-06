import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createPhotoCamera,
  captureVideoFrame,
} from "../src/services/photoCamera.js";
import { reportProgress } from "../src/utils/reportProgress.js";
import { citizenAction } from "../src/utils/citizenChanges.js";
import { validateDecodedPhoto } from "../src/utils/evidenceValidation.js";
function fixture(options = {}) {
  const states = [],
    requests = [],
    streams = [];
  const file = new File([new Uint8Array([255, 216, 255, 1])], "capture.jpg", {
    type: "image/jpeg",
  });
  function stream() {
    let stops = 0;
    const track = {
      readyState: "live",
      stop() {
        stops++;
        this.readyState = "ended";
      },
    };
    const audio = {
      stop() {
        stops++;
      },
    };
    const value = {
      getTracks: () => [track, audio],
      getVideoTracks: () => [track],
      stops: () => stops,
    };
    streams.push(value);
    return value;
  }
  const session = createPhotoCamera({
    getMedia: async (c) => {
      requests.push(c);
      return stream();
    },
    capture: async () => file,
    onState: (s) => states.push(s),
    ...options,
  });
  return { session, states, requests, streams, file, stream };
}
test("camera requires explicit open, requests video-only with optional environment preference", async () => {
  const f = fixture();
  assert.equal(f.requests.length, 0);
  await f.session.open();
  assert.deepEqual(f.requests, [
    { video: { facingMode: { ideal: "environment" } }, audio: false },
  ]);
  f.session.dispose();
  assert.equal(f.streams[0].stops(), 2);
});
test("capture, retake and use produce only camera workflow provenance and stop every track", async () => {
  const f = fixture();
  await f.session.open();
  await f.session.take({});
  assert.equal(f.states.at(-1).phase, "preview");
  assert.equal(f.streams[0].stops(), 2);
  await f.session.retake();
  assert.equal(f.requests.length, 2);
  await f.session.take({});
  const photo = f.session.use();
  assert.equal(photo.source, "camera");
  assert.equal(photo.capturedInApp, true);
  assert.equal(photo.file, f.file);
  assert.equal(f.states.at(-1).phase, "closed");
  assert.equal(f.streams[1].stops(), 2);
  assert.equal(f.session.use(), null);
});
for (const exit of ["cancel", "dispose", "open"])
  test(`${exit} stops the existing stream`, async () => {
    const f = fixture();
    await f.session.open();
    await f.session[exit]();
    assert.equal(f.streams[0].stops(), 2);
    f.session.dispose();
  });
for (const name of ["NotAllowedError", "NotFoundError", "NotReadableError"])
  test(`${name} retains Upload Photo fallback`, async () => {
    const f = fixture({
      getMedia: async () => {
        throw Object.assign(new Error("PRIVATE"), { name });
      },
    });
    await f.session.open();
    assert.equal(f.states.at(-1).phase, "error");
    assert.match(f.states.at(-1).error, /Upload Photo/);
    assert.ok(!f.states.at(-1).error.includes("PRIVATE"));
  });
test("missing camera API gives friendly fallback without permissions", async () => {
  const f = fixture({ getMedia: undefined });
  await f.session.open();
  assert.equal(f.states.at(-1).phase, "error");
  assert.match(f.states.at(-1).error, /unavailable/);
});
test("invalid stream is stopped", async () => {
  let stopped = 0;
  const f = fixture({
    getMedia: async () => ({
      getTracks: () => [
        {
          stop() {
            stopped++;
          },
        },
      ],
      getVideoTracks: () => [],
    }),
  });
  await f.session.open();
  assert.equal(stopped, 1);
  assert.equal(f.states.at(-1).phase, "error");
});
for (const exit of ["cancel", "dispose"])
  test(`late permission stream after ${exit} is stopped and never displayed`, async () => {
    let release;
    const f = fixture({ getMedia: () => new Promise((r) => (release = r)) });
    const opening = f.session.open();
    f.session[exit]();
    const stream = f.stream();
    release(stream);
    await opening;
    assert.equal(stream.stops(), 2);
    assert.ok(!f.states.some((s) => s.phase === "live"));
  });
test("capture failure stops tracks without accepting a photo", async () => {
  const f = fixture({
    capture: async () => {
      throw Error("PRIVATE");
    },
  });
  await f.session.open();
  await f.session.take({});
  assert.equal(f.streams[0].stops(), 2);
  assert.equal(f.session.use(), null);
  assert.match(f.states.at(-1).error, /could not be captured/);
});
test("failed image validation also stops tracks", async () => {
  const f = fixture({
    validate: async () => {
      throw Error("Bad photo");
    },
  });
  await f.session.open();
  await f.session.take({});
  assert.equal(f.streams[0].stops(), 2);
  assert.equal(f.session.use(), null);
});
test("cancel during capture suppresses late accepted photo", async () => {
  let release;
  const f = fixture({ capture: () => new Promise((r) => (release = r)) });
  await f.session.open();
  const taking = f.session.take({});
  f.session.cancel();
  release(f.file);
  await taking;
  assert.equal(f.session.use(), null);
  assert.ok(!f.states.some((s) => s.phase === "preview"));
});
test("still frame draws ready video to JPEG and rejects unready video", async () => {
  const previous = globalThis.document;
  let drew = false,
    mime;
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage() {
          drew = true;
        },
      }),
      toBlob(callback, type) {
        mime = type;
        callback(new Blob(["photo"], { type }));
      },
    }),
  };
  try {
    await assert.rejects(captureVideoFrame({ readyState: 0 }), /not ready/);
    const file = await captureVideoFrame({
      readyState: 2,
      videoWidth: 640,
      videoHeight: 480,
    });
    assert.ok(drew);
    assert.equal(mime, "image/jpeg");
    assert.equal(file.type, "image/jpeg");
  } finally {
    globalThis.document = previous;
  }
});
for (const [index, status] of [
  "reported",
  "acknowledged",
  "assigned",
  "in_progress",
  "resolved",
].entries())
  test(`progress ${status} derives all five stages from current canonical status`, () => {
    const steps = reportProgress(status);
    assert.equal(steps.length, 5);
    assert.equal(steps[index].state, "current");
    assert.ok(steps.slice(0, index).every((s) => s.state === "completed"));
    assert.ok(steps.slice(index + 1).every((s) => s.state === "future"));
    assert.ok(steps.every((s) => !Object.hasOwn(s, "timestamp")));
    assert.equal(
      citizenAction(status),
      index === 0 ? "Edit Report" : index === 4 ? "View Details" : "Add Update",
    );
  });
test("unknown status gives no invented workflow", () => {
  assert.equal(reportProgress("legacy"), null);
  assert.equal(reportProgress(null), null);
});
test("form separates explicit camera from upload and keeps required evidence/voice guards", async () => {
  const form = await readFile(
    new URL("../src/components/IncidentForm.jsx", import.meta.url),
    "utf8",
  );
  assert.ok(!form.includes('capture="environment"'));
  assert.match(form, /onClick=\{\(\)=>setCameraOpen\(true\)\}>Take Photo/);
  assert.match(form, /source:'upload'/);
  assert.match(form, /Captured in NigraanOS/);
  assert.match(form, /Uploaded photo/);
  assert.ok(form.includes("!gps || !photo"));
  assert.ok(form.includes("voice.recording || voice.starting"));
  assert.ok(form.includes("submissionTranscript(transcription.state)"));
  assert.ok(form.includes("createReport("));
  const camera = await readFile(
    new URL("../src/components/PhotoCamera.jsx", import.meta.url),
    "utf8",
  );
  assert.ok(camera.includes("session.dispose()"));
  assert.ok(camera.includes("session.open()") === false);
  assert.match(camera, /onClick=\{\(\)\s*=>\s*camera.current\?\.open\(\)\}/);
  assert.ok(camera.includes('aria-modal="true"'));
});
test("unexpected live stream ending stops all tracks and removes capture readiness", async () => {
  let ended,
    stops = 0;
  const track = {
    readyState: "live",
    addEventListener(name, callback) {
      assert.equal(name, "ended");
      ended = callback;
    },
    stop() {
      stops++;
    },
  };
  const f = fixture({
    getMedia: async () => ({
      getVideoTracks: () => [track],
      getTracks: () => [track],
    }),
  });
  await f.session.open();
  ended();
  assert.equal(stops, 1);
  assert.equal(f.states.at(-1).phase, "error");
  assert.match(f.states.at(-1).error, /stream ended/);
  assert.equal(f.session.use(), null);
});
test("shared image decoding rejects zero dimensions/failure and always revokes preview URL", async () => {
  const oldImage = globalThis.Image,
    oldCreate = URL.createObjectURL,
    oldRevoke = URL.revokeObjectURL;
  let mode = "valid",
    revoked = 0;
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => revoked++;
  globalThis.Image = class {
    set src(value) {
      assert.equal(value, "blob:test");
      this.naturalWidth = mode === "zero" ? 0 : 10;
      this.naturalHeight = 10;
      if (mode === "failure") this.onerror();
      else this.onload();
    }
  };
  const file = new File([new Uint8Array([255, 216, 255])], "photo.jpg", {
    type: "image/jpeg",
  });
  try {
    await validateDecodedPhoto(file);
    mode = "zero";
    await assert.rejects(validateDecodedPhoto(file), /dimensions/);
    mode = "failure";
    await assert.rejects(validateDecodedPhoto(file), /decode/);
    assert.equal(revoked, 3);
  } finally {
    globalThis.Image = oldImage;
    URL.createObjectURL = oldCreate;
    URL.revokeObjectURL = oldRevoke;
  }
});
