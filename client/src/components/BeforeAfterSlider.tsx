import { useState, useRef, useCallback, useEffect } from "react";

interface BeforeAfterSliderProps {
  beforeImage: string;
  afterImage: string;
  beforeLabel?: string;
  afterLabel?: string;
}

export default function BeforeAfterSlider({
  beforeImage,
  afterImage,
  beforeLabel = "BEFORE",
  afterLabel = "AFTER",
}: BeforeAfterSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const getPositionFromEvent = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return sliderPosition;
      const rect = containerRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const percentage = (x / rect.width) * 100;
      return Math.min(100, Math.max(0, percentage));
    },
    [sliderPosition]
  );

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      setSliderPosition(getPositionFromEvent(e.clientX));
    },
    [isDragging, getPositionFromEvent]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleTouchStart = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      setSliderPosition(getPositionFromEvent(e.touches[0].clientX));
    },
    [isDragging, getPositionFromEvent]
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("touchmove", handleTouchMove, { passive: false });
      window.addEventListener("touchend", handleTouchEnd);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-lg overflow-hidden select-none"
      style={{ cursor: isDragging ? "ew-resize" : "default" }}
    >
      {/* After Image (background layer) */}
      <img
        src={afterImage}
        alt={afterLabel}
        className="block w-full h-auto"
        draggable={false}
      />

      {/* Before Image (clipped overlay) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${sliderPosition}%` }}
      >
        <img
          src={beforeImage}
          alt={beforeLabel}
          className="block h-full object-cover"
          style={{ width: containerRef.current?.offsetWidth ?? "100%" }}
          draggable={false}
        />
      </div>

      {/* Before Label */}
      <span
        className="absolute top-3 left-3 px-3 py-1 text-white text-xs font-bold uppercase rounded"
        style={{ backgroundColor: "#F44336" }}
      >
        {beforeLabel}
      </span>

      {/* After Label */}
      <span
        className="absolute top-3 right-3 px-3 py-1 text-white text-xs font-bold uppercase rounded"
        style={{ backgroundColor: "#4CAF50" }}
      >
        {afterLabel}
      </span>

      {/* Divider Line */}
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: `${sliderPosition}%`,
          transform: "translateX(-50%)",
          width: "3px",
          backgroundColor: "#FDB913",
          cursor: "ew-resize",
        }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* Circle Grip */}
        <div
          className="absolute top-1/2 left-1/2 flex items-center justify-center"
          style={{
            transform: "translate(-50%, -50%)",
            width: "40px",
            height: "40px",
            borderRadius: "50%",
            backgroundColor: "#FDB913",
            boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M6 4L2 10L6 16"
              stroke="#1A1A1A"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M14 4L18 10L14 16"
              stroke="#1A1A1A"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
