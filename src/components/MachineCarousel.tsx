"use client";

import { useState } from "react";
import Image from "next/image";

const machines = [
  { id: 1, src: "/images/tcn-vending.jpg",      alt: "TCN Vending Machine" },
  { id: 2, src: "/images/tokio-mini.jpg",       alt: "Tokio Machine Mini" },
  { id: 3, src: "/images/funhouse.jpg",         alt: "Funhouse" },
  { id: 4, src: "/images/funhouse-sonic.jpg",   alt: "Funhouse Sonic" },
  { id: 5, src: "/images/blaaze.jpg",           alt: "Blaaze" }
];

export default function MachineCarousel() {
  const [current, setCurrent] = useState(0);

  const prev = () => setCurrent((c) => (c - 1 + machines.length) % machines.length);
  const next = () => setCurrent((c) => (c + 1) % machines.length);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-10">

      {/* Mobile: 1 card at a time */}
      <div className="md:hidden relative px-8">
        <div className="relative h-[65vh] bg-white rounded-2xl overflow-hidden">
          <Image
            src={machines[current].src}
            alt={machines[current].alt}
            fill
            className="object-contain p-4"
            priority
          />
        </div>
        <button
          onClick={prev}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-red-600 text-white text-2xl font-bold flex items-center justify-center shadow-lg hover:bg-red-700 transition"
          aria-label="Anterior"
        >‹</button>
        <button
          onClick={next}
          className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-red-600 text-white text-2xl font-bold flex items-center justify-center shadow-lg hover:bg-red-700 transition"
          aria-label="Próximo"
        >›</button>
      </div>

      {/* Desktop: all 5 cards side by side */}
      <div className="hidden md:flex items-center gap-4">
        <button
          onClick={prev}
          className="flex-shrink-0 w-10 h-10 rounded-full bg-red-600 text-white text-2xl font-bold flex items-center justify-center shadow-lg hover:bg-red-700 active:scale-95 transition"
          aria-label="Anterior"
        >‹</button>

        <div className="flex flex-1 gap-4">
          {machines.map((m) => (
            <div
              key={m.id}
              className="flex-1 relative h-80 lg:h-96 bg-white rounded-2xl overflow-hidden"
            >
              <Image
                src={m.src}
                alt={m.alt}
                fill
                className="object-contain p-3"
                sizes="(min-width: 1280px) 260px, 20vw"
              />
            </div>
          ))}
        </div>

        <button
          onClick={next}
          className="flex-shrink-0 w-10 h-10 rounded-full bg-red-600 text-white text-2xl font-bold flex items-center justify-center shadow-lg hover:bg-red-700 active:scale-95 transition"
          aria-label="Próximo"
        >›</button>
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-2 mt-8">
        {machines.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`h-2.5 rounded-full transition-all duration-300 ${
              i === current
                ? "bg-red-600 w-6"
                : "bg-gray-600 w-2.5 hover:bg-gray-400"
            }`}
            aria-label={`Máquina ${i + 1}`}
          />
        ))}
      </div>

      {/* CTA */}
      <div className="flex justify-center mt-10">
        <button className="bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold tracking-widest uppercase text-sm px-10 py-4 rounded-full shadow-lg shadow-red-500/30 transition-all">
          SOLICITAR ORÇAMENTO →
        </button>
      </div>
    </div>
  );
}
