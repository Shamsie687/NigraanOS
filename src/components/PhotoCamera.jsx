import { useEffect, useRef, useState } from "react";
import { createPhotoCamera, captureVideoFrame } from "../services/photoCamera";
import { validateDecodedPhoto } from "../utils/evidenceValidation";
import useObjectUrl from "../hooks/useObjectUrl";

export default function PhotoCamera({ onUse, onClose }) {
  const [state, setState] = useState({ phase: "closed" });
  const video = useRef(null),
    panel = useRef(null),
    camera = useRef(null),
    returnFocus = useRef(null);
  const preview = useObjectUrl(state.photo?.file);
  // Keep focus inside the dialog when Capture/Retake replaces its controls.
  useEffect(() => { panel.current?.focus(); }, [state.phase]);
  useEffect(() => {
    returnFocus.current = document.activeElement;
    const session = createPhotoCamera({
      getMedia: navigator.mediaDevices?.getUserMedia?.bind(
        navigator.mediaDevices,
      ),
      capture: captureVideoFrame,
      validate: validateDecodedPhoto,
      onState: setState,
    });
    camera.current = session;
    panel.current?.focus();
    return () => {
      session.dispose();
      camera.current = null;
      returnFocus.current?.focus();
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (video.current) {
      video.current.srcObject = state.stream || null;
      if (state.stream)
        video.current.play().catch(() => {
          if (active) {
            camera.current?.cancel();
            setState({
              phase: "error",
              error:
                "Camera preview could not start. Try again or use Upload Photo.",
            });
          }
        });
    }
    return () => {
      active = false;
    };
  }, [state.stream]);
  function close() {
    camera.current?.cancel();
    onClose();
  }
  function keys(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "Tab") {
      const buttons = [
        ...panel.current.querySelectorAll("button:not(:disabled)"),
      ];
      const first = buttons[0],
        last = buttons.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panel.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === panel.current)
      ) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
  return (
    <div className="photo-camera-backdrop">
      <section
        className="photo-camera"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-camera-title"
        aria-describedby="photo-camera-help"
        tabIndex={-1}
        ref={panel}
        onKeyDown={keys}
      >
        <h3 id="photo-camera-title">Take a photo</h3>
        <p id="photo-camera-help">
          Video only. Nothing is uploaded here. Camera location does not prove
          where the incident happened.
        </p>
        {state.phase === "closed" && (
          <button
            type="button"
            className="primary"
            onClick={() => camera.current?.open()}
          >
            Enable camera
          </button>
        )}
        {state.phase === "opening" && (
          <p role="status">Requesting camera access…</p>
        )}
        {["live", "capturing"].includes(state.phase) && (
          <>
            <video
              ref={video}
              autoPlay
              playsInline
              muted
              aria-label="Live camera preview"
            />
            <button
              type="button"
              disabled={state.phase === "capturing"}
              onClick={() => camera.current?.take(video.current)}
            >
              {state.phase === "capturing" ? "Capturing…" : "Capture Photo"}
            </button>
          </>
        )}
        {state.phase === "preview" && (
          <>
            <img src={preview || undefined} alt="Captured photo for review" />
            <div className="evidence-actions">
              <button type="button" onClick={() => camera.current?.retake()}>
                Retake
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const photo = camera.current?.use();
                  if (photo) onUse(photo);
                }}
              >
                Use Photo
              </button>
            </div>
          </>
        )}
        {state.phase === "error" && (
          <>
            <p role="alert">{state.error}</p>
            <button type="button" onClick={() => camera.current?.open()}>
              Try camera again
            </button>
          </>
        )}
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" className="text-button" onClick={close}>
          Use Upload Photo instead
        </button>
      </section>
    </div>
  );
}
