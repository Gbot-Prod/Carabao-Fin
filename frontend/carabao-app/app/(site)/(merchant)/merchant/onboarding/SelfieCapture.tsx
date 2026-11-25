"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import pageStyles from "./page.module.css";
import styles from "./SelfieCapture.module.css";

/** The longest side of the photo that is sent (backend re-encodes it again). */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;

type Facing = "user" | "environment";
type Phase = "idle" | "starting" | "live" | "review";

/** An error message when no selfie is taken yet, or null. */
export function selfieError(file: File | null): string | null {
  return file ? null : "Take a selfie while you hold your government ID.";
}

/** A message the applicant can act on, for a getUserMedia error. */
function cameraErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera access is blocked. Allow the camera for this site in your browser settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No camera was found. Continue your application on a phone, or connect a webcam.";
  if (name === "NotReadableError")
    return "Another app is using the camera. Close that app, then try again.";
  return "The camera could not start. Try again, or continue your application on a phone.";
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

type Props = {
  file: File | null;
  onChange: (file: File | null) => void;
};

/**
 * Selfie with ID: a live camera photo only (no file pick, no gallery).
 * Front camera first; the applicant can switch to the rear camera (for
 * example when a family member takes the photo).
 */
export default function SelfieCapture({ file, onChange }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [facing, setFacing] = useState<Facing>("user");
  const [canSwitch, setCanSwitch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The photo just taken, before "Use photo".
  const [shot, setShot] = useState<File | null>(null);
  const shown = phase === "review" ? shot : file;
  const previewUrl = useMemo(() => (shown ? URL.createObjectURL(shown) : null), [shown]);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const stop = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
  }, []);

  // Release the camera when the step closes.
  useEffect(() => stop, [stop]);

  const start = useCallback(
    async (wanted: Facing) => {
      setError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        // Old browsers, and pages not on https.
        setError("This browser cannot open the camera. Continue your application on a phone with Chrome or Safari.");
        setPhase("idle");
        return;
      }
      setPhase("starting");
      stop();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: wanted }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        streamRef.current = stream;
        setFacing(wanted);
        setPhase("live");
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setCanSwitch(devices.filter((d) => d.kind === "videoinput").length > 1);
      } catch (e) {
        setError(cameraErrorMessage(e));
        setPhase("idle");
      }
    },
    [stop],
  );

  // Attach the stream once the <video> is on the page.
  useEffect(() => {
    const video = videoRef.current;
    if (phase !== "live" || !video || !streamRef.current) return;
    video.srcObject = streamRef.current;
    video.play().catch(() => undefined);
  }, [phase, facing]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return;
    // Not mirrored: the ID text must read the correct way.
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return setError("The photo could not be saved. Try again.");
        stop();
        setShot(new File([blob], "selfie-with-id.jpg", { type: "image/jpeg" }));
        setPhase("review");
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  };

  const acceptPhoto = () => {
    onChange(shot);
    setShot(null);
    setPhase("idle");
  };

  const retake = () => {
    setShot(null);
    void start(facing);
  };

  const cancel = () => {
    stop();
    setShot(null);
    setPhase("idle");
  };

  return (
    <div className={styles.capture}>
      <ul className={styles.tips}>
        <li>Hold your ID next to your face. Show your full face and the full card.</li>
        <li>Make sure that the text on the ID is clear and easy to read.</li>
        <li>Use good light. Do not wear a cap, mask or sunglasses.</li>
      </ul>

      {phase === "live" || phase === "starting" ? (
        <div className={styles.stage}>
          <video
            ref={videoRef}
            className={`${styles.video} ${facing === "user" ? styles.mirrored : ""}`}
            playsInline
            muted
            autoPlay
            aria-label="Camera preview"
          />
          <div className={styles.actions}>
            <button type="button" className={`${pageStyles.primaryBtn} ${styles.shutter}`} onClick={capture} disabled={phase !== "live"}>
              Take photo
            </button>
            {canSwitch && (
              <button type="button" className={pageStyles.secondaryBtn} onClick={() => void start(facing === "user" ? "environment" : "user")}>
                Switch camera
              </button>
            )}
            <button type="button" className={pageStyles.secondaryBtn} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : shown && previewUrl ? (
        <div className={styles.stage}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL */}
          <img src={previewUrl} alt="Your selfie with ID" className={styles.preview} />
          <div className={styles.actions}>
            {phase === "review" ? (
              <>
                <button type="button" className={pageStyles.primaryBtn} onClick={acceptPhoto}>
                  Use photo
                </button>
                <button type="button" className={pageStyles.secondaryBtn} onClick={retake}>
                  Retake
                </button>
              </>
            ) : (
              <button type="button" className={pageStyles.secondaryBtn} onClick={() => void start(facing)}>
                Retake
              </button>
            )}
          </div>
        </div>
      ) : (
        <button type="button" className={`${pageStyles.primaryBtn} ${styles.open}`} onClick={() => void start("user")}>
          Open camera
        </button>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
