import { validatePhoto } from "../utils/evidenceValidation.js";

export const CAMERA_CONSTRAINTS = {
  video: { facingMode: { ideal: "environment" } },
  audio: false,
};
const stop = (stream) => stream?.getTracks().forEach((track) => track.stop());
const message = (error) =>
  error?.name === "NotAllowedError"
    ? "Camera permission was denied. Allow access and try again, or use Upload Photo."
    : error?.name === "NotFoundError"
      ? "No camera was found. Connect a webcam or use Upload Photo."
      : "Camera could not be used. Try again or use Upload Photo.";

// No permissions or device work occurs until open/retake is explicitly called.
export function createPhotoCamera({
  getMedia,
  capture,
  validate = validatePhoto,
  onState = () => {},
}) {
  let generation = 0,
    stream = null,
    photo = null,
    disposed = false,
    capturing = false;
  const emit = (state) => {
    if (!disposed) onState(state);
  };
  function close() {
    generation++;
    stop(stream);
    stream = null;
    photo = null;
    capturing = false;
    emit({ phase: "closed" });
  }
  async function open() {
    close();
    const version = generation;
    if (!getMedia) {
      emit({
        phase: "error",
        error: "Camera is unavailable in this browser. Use Upload Photo.",
      });
      return;
    }
    emit({ phase: "opening" });
    let next;
    try {
      next = await getMedia(CAMERA_CONSTRAINTS);
      if (disposed || version !== generation) {
        stop(next);
        return;
      }
      if (
        !next?.getVideoTracks().length ||
        next.getVideoTracks().every((t) => t.readyState === "ended")
      )
        throw new Error("No live video");
      stream = next;
      for (const track of next.getVideoTracks())
        track.addEventListener?.(
          "ended",
          () => {
            if (stream === next && version === generation) {
              generation++;
              stop(stream);
              stream = null;
              capturing = false;
              emit({
                phase: "error",
                error: "Camera stream ended. Try again or use Upload Photo.",
              });
            }
          },
          { once: true },
        );
      emit({ phase: "live", stream });
    } catch (error) {
      stop(next);
      if (version === generation) {
        stop(stream);
        stream = null;
        emit({ phase: "error", error: message(error) });
      }
    }
  }
  async function take(video) {
    if (!stream || photo || disposed || capturing) return;
    const version = generation;
    capturing = true;
    emit({ phase: "capturing", stream });
    try {
      const file = await capture(video);
      await validate(file);
      if (version !== generation || disposed) return;
      photo = { file, source: "camera", capturedInApp: true };
      const current = stream;
      stream = null;
      stop(current);
      capturing = false;
      emit({ phase: "preview", photo });
    } catch {
      if (version === generation) {
        stop(stream);
        stream = null;
        capturing = false;
        emit({
          phase: "error",
          error: "Photo could not be captured. Try again or use Upload Photo.",
        });
      }
    }
  }
  return {
    open,
    take,
    retake: open,
    cancel: close,
    use() {
      const value = photo;
      if (!value) return null;
      close();
      return value;
    },
    dispose() {
      close();
      disposed = true;
    },
  };
}

export async function captureVideoFrame(video) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight)
    throw new Error("Camera is not ready");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Capture unavailable");
  context.drawImage(video, 0, 0);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("Capture failed"))),
      "image/jpeg",
      0.9,
    ),
  );
  return new File([blob], "incident-photo.jpg", { type: "image/jpeg" });
}
