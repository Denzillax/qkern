"use client";

import { useEffect, useRef } from "react";
import styles from "@/app/page.module.css";

/**
 * Der Q-Orbit (2.11): ein Canvas hinter der Hero-Überschrift, nach dem
 * Vorbild des Partikelrings auf nexalead.framer.ai, mit dem Q in der Mitte.
 *
 * Rund 1400 Partikel liegen auf drei gleich geneigten Bahnen um das Q, als
 * ein Körper: alle drehen gleichläufig, hinten kleiner und blasser. Die
 * Maus kippt den ganzen Körper sanft; Partikel in Zeigernähe weichen
 * leicht aus. Das Q selbst steht still. Ohne Zeiger dreht der Orbit
 * langsam von selbst (2.11.1: ruhiger, nach Denzils Befund „bewegt sich
 * komisch“ — vorher drei Richtungen, Wackeln und ein mitdrehendes Q).
 *
 * Wo er stillhält: `prefers-reduced-motion` zeichnet ein einziges Bild;
 * ausserhalb des Sichtfelds pausiert die Schleife; auf Touch-Geräten gibt
 * es nur die Eigendrehung. Rein dekorativ, `aria-hidden`, keine Klicks.
 */
const Q_PATH = "M 426.11325315265435 339.61600182611454 L 376.67010002004827 339.61600182611454 L 327.2269468874422 306.6555238065957 L 376.67010002004827 273.69017358042186 L 327.2269468874422 240.72969556090277 L 376.67010002004827 240.72969556090277 L 426.11325315265435 273.69017358042186 L 376.67010002004827 306.6555238065956 L 426.11325315265435 339.61600182611454 Z M 277.788665961491 240.72969556090277 L 327.2269468874424 240.72969556090277 L 277.788665961491 273.69017358042186 L 327.2269468874424 306.6555238065957 L 277.788665961491 306.6555238065957 L 228.34551282888538 273.69017358042186 L 277.788665961491 240.72969556090277 Z";

type Particle = { angle: number; radius: number; band: number; speed: number; size: number; jitter: number; push: number; pushAngle: number };

const BANDS = [
  { tilt: 1.15, spin: 0.5, radius: 0.74, spread: 0.05, count: 520 },
  { tilt: 1.15, spin: 0.62, radius: 0.62, spread: 0.04, count: 440 },
  { tilt: 1.15, spin: 0.4, radius: 0.86, spread: 0.06, count: 440 },
];

/** Deterministischer Zufall, damit jeder Besuch denselben Ring sieht. */
function mulberry(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function HeroOrbit() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const random = mulberry(20260925);
    const particles: Particle[] = [];
    BANDS.forEach((band, index) => {
      for (let i = 0; i < band.count; i += 1) {
        particles.push({
          angle: random() * Math.PI * 2, radius: band.radius + (random() - 0.5) * band.spread * 2, band: index,
          speed: (0.85 + random() * 0.3) * band.spin, size: 0.8 + random() * 1.6, jitter: random() * Math.PI * 2, push: 0, pushAngle: 0,
        });
      }
    });
    const q = new Path2D(Q_PATH);
    let width = 0, height = 0, dpr = 1;
    const target = { rx: 0, ry: 0 }; const current = { rx: 0, ry: 0 };
    const mouse = { x: -1, y: -1, inside: false };
    let last = performance.now(); let frame = 0; let visible = true;
    const primary = getComputedStyle(canvas).color || "#004dd5";

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = rect.width; height = rect.height;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (dt: number) => {
      current.rx += (target.rx - current.rx) * 0.035;
      current.ry += (target.ry - current.ry) * 0.035;
      context.clearRect(0, 0, width, height);
      const cx = width / 2, cy = height / 2, base = Math.min(width, height) / 2;
      const cosX = Math.cos(current.rx), sinX = Math.sin(current.rx);
      const cosY = Math.cos(current.ry), sinY = Math.sin(current.ry);
      const drawn: Array<{ x: number; y: number; z: number; size: number }> = [];
      for (const p of particles) {
        const band = BANDS[p.band];
        p.angle += p.speed * dt * 0.00035;
        const r = p.radius * base;
        // Punkt auf einem Kreis, um die Bahnneigung gekippt, dann um die Blickachsen gedreht.
        let x = Math.cos(p.angle) * r, y = Math.sin(p.angle) * r * Math.cos(band.tilt), z = Math.sin(p.angle) * r * Math.sin(band.tilt);
        let y2 = y * cosX - z * sinX, z2 = y * sinX + z * cosX;
        let x2 = x * cosY + z2 * sinY; z2 = -x * sinY + z2 * cosY;
        x = x2; y = y2;
        // Ausweichen: Partikel nahe dem Zeiger werden nach aussen gedrueckt und kehren zurueck.
        if (mouse.inside) {
          const dx = x + cx - mouse.x, dy = y + cy - mouse.y; const dist = Math.hypot(dx, dy);
          if (dist < 90) { const force = (90 - dist) / 90; p.push = Math.min(1, p.push + force * dt * 0.006); p.pushAngle = Math.atan2(dy, dx); }
        }
        p.push *= Math.pow(0.94, dt / 16);
        x += Math.cos(p.pushAngle) * p.push * 28; y += Math.sin(p.pushAngle) * p.push * 28;
        drawn.push({ x: x + cx, y: y + cy, z: z2 / base, size: p.size });
      }
      drawn.sort((a, b) => a.z - b.z);
      for (const point of drawn) {
        const depth = (point.z + 1) / 2; // 0 hinten, 1 vorne
        context.globalAlpha = 0.18 + depth * 0.6;
        context.fillStyle = primary;
        context.beginPath();
        context.arc(point.x, point.y, point.size * (0.55 + depth * 0.8), 0, Math.PI * 2);
        context.fill();
      }
      // Das Q in der Mitte, leicht mitgedreht, mit weichem Halo.
      const qSize = base * 0.52;
      context.globalAlpha = 1;
      context.save();
      context.translate(cx, cy);
      const halo = context.createRadialGradient(0, 0, qSize * 0.2, 0, 0, qSize * 1.1);
      halo.addColorStop(0, "rgba(0, 77, 213, 0.16)"); halo.addColorStop(1, "rgba(0, 77, 213, 0)");
      context.fillStyle = halo; context.beginPath(); context.arc(0, 0, qSize * 1.1, 0, Math.PI * 2); context.fill();
      context.scale(qSize / 238, qSize / 238);
      context.translate(-208 - 119, -220 - 70);
      context.fillStyle = primary;
      context.globalAlpha = 0.92;
      context.fill(q);
      context.restore();
      context.globalAlpha = 1;
    };

    const loop = (now: number) => {
      const dt = Math.min(48, now - last); last = now;
      draw(dt);
      if (!reduced && visible) frame = requestAnimationFrame(loop);
    };
    const onMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const nx = (event.clientX - rect.left) / rect.width - 0.5, ny = (event.clientY - rect.top) / rect.height - 0.5;
      target.ry = nx * 0.45; target.rx = -ny * 0.35;
      mouse.x = event.clientX - rect.left; mouse.y = event.clientY - rect.top;
      mouse.inside = mouse.x >= -60 && mouse.x <= rect.width + 60 && mouse.y >= -60 && mouse.y <= rect.height + 60;
    };
    const onLeave = () => { mouse.inside = false; target.rx = 0; target.ry = 0; };
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible && !reduced) { cancelAnimationFrame(frame); last = performance.now(); frame = requestAnimationFrame(loop); }
    });
    resize();
    observer.observe(canvas);
    const sizes = new ResizeObserver(resize); sizes.observe(canvas);
    window.addEventListener("resize", resize);
    if (pointer && !reduced) { window.addEventListener("mousemove", onMove, { passive: true }); document.addEventListener("mouseleave", onLeave); }
    if (reduced) draw(0); else frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); sizes.disconnect(); window.removeEventListener("resize", resize); window.removeEventListener("mousemove", onMove); document.removeEventListener("mouseleave", onLeave); };
  }, []);
  return <canvas ref={canvasRef} className={styles.orbit} aria-hidden="true"/>;
}
