import { useState, useEffect } from "react";

export default function useCountdown() {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) {
      return;
    }

    const intervalId = setInterval(() => {
      setSecondsLeft(secondsLeft - 1);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [secondsLeft]);

  function startCountdown(duration: number) {
    setSecondsLeft(duration);
  }

  return { secondsLeft, startCountdown };
}