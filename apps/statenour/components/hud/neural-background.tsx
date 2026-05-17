"use client";

import { useEffect, useRef } from "react";

/**
 * NeuralBackground — Data-reactive particle canvas.
 * Responds to mouse movement AND system state (alerts, revenue).
 * Intensity increases when there are alerts or when data changes.
 * Performance-optimized: requestAnimationFrame, reduced motion, mobile throttle.
 */
export function NeuralBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const frameRef = useRef<number>(0);
  const intensityRef = useRef(0.4); // 0.2 = calm, 0.6 = alert, 1.0 = critical

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Respect reduced motion preference
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Lower particle count on mobile for performance
    const isMobile = window.innerWidth < 768;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    // Particle system — fewer on mobile
    const PARTICLE_COUNT = isMobile
      ? Math.min(25, Math.floor((width * height) / 50000))
      : Math.min(60, Math.floor((width * height) / 25000));
    const CONNECTION_DISTANCE = isMobile ? 100 : 150;
    const MOUSE_INFLUENCE = 200;
    const GOLD = { r: 253, g: 185, b: 19 };
    const RED = { r: 239, g: 68, b: 68 };
    const GREEN = { r: 34, g: 197, b: 94 };

    interface Particle {
      x: number; y: number;
      vx: number; vy: number;
      size: number; opacity: number;
    }

    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 1.5 + 0.5,
      opacity: Math.random() * 0.3 + 0.05,
    }));

    // Listen for system state changes (dispatched by dashboard)
    function handleIntensity(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.intensity !== undefined) intensityRef.current = detail.intensity;
    }
    window.addEventListener("neural-intensity", handleIntensity);

    let frameCount = 0;

    function draw() {
      if (!ctx) return;
      frameCount++;

      // Skip every other frame on mobile
      if (isMobile && frameCount % 2 !== 0) {
        frameRef.current = requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, width, height);

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const intensity = intensityRef.current;

      // Choose color blend based on intensity (gold → red for alerts)
      const color = intensity > 0.7
        ? RED
        : intensity > 0.5
        ? { r: Math.round(GOLD.r + (RED.r - GOLD.r) * ((intensity - 0.5) / 0.2)), g: Math.round(GOLD.g + (RED.g - GOLD.g) * ((intensity - 0.5) / 0.2)), b: GOLD.b }
        : GOLD;

      // Update and draw particles
      for (const p of particles) {
        // Mouse influence — particles drift toward cursor
        const dx = mx - p.x;
        const dy = my - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_INFLUENCE && dist > 0) {
          const force = (MOUSE_INFLUENCE - dist) / MOUSE_INFLUENCE * (0.008 + intensity * 0.01);
          p.vx += dx * force / dist;
          p.vy += dy * force / dist;
        }

        // Intensity-based speed boost
        const speedMul = 1 + intensity * 0.5;
        p.x += p.vx * speedMul;
        p.y += p.vy * speedMul;
        p.vx *= 0.99;
        p.vy *= 0.99;

        // Wrap around edges
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        // Draw particle — size & opacity scale with intensity
        const drawSize = p.size * (1 + intensity * 0.5);
        const drawOpacity = p.opacity * (1 + intensity * 1.5);
        ctx.beginPath();
        ctx.arc(p.x, p.y, drawSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${drawOpacity})`;
        ctx.fill();
      }

      // Draw connections — more visible at higher intensity
      const connAlphaBase = 0.06 + intensity * 0.08;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < CONNECTION_DISTANCE) {
            const alpha = (1 - dist / CONNECTION_DISTANCE) * connAlphaBase;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Draw mouse influence radius (subtle)
      if (mx > 0 && my > 0) {
        ctx.beginPath();
        ctx.arc(mx, my, 3 + intensity * 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${0.15 + intensity * 0.1})`;
        ctx.fill();
      }

      frameRef.current = requestAnimationFrame(draw);
    }

    // Mouse tracking
    function handleMouseMove(e: MouseEvent) {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    }

    // Resize handler
    function handleResize() {
      if (!canvas) return;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    }

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });
    frameRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("neural-intensity", handleIntensity);
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.4 }}
    />
  );
}
