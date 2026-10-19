import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";

type Item = { id: string; storage_url: string; thumbnail_url: string | null; caption: string | null; alt_text: string | null };

export function Lightbox({ images }: { images: Item[] }) {
  const [index, setIndex] = useState<number | null>(null);
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIndex(null);
      if (e.key === "ArrowRight") setIndex((i) => (i === null ? i : (i + 1) % images.length));
      if (e.key === "ArrowLeft") setIndex((i) => (i === null ? i : (i - 1 + images.length) % images.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length]);
  if (!images.length) return null;
  const current = index !== null ? images[index] : null;
  return (
    <>
      <div className="mt-8 columns-2 gap-3 sm:columns-3 lg:columns-4">
        {images.map((m, i) => (
          <button key={m.id} onClick={() => setIndex(i)} className="group mb-3 block w-full overflow-hidden rounded-3xl" aria-label={`Open ${m.caption ?? "photo"}`}>
            <img src={m.thumbnail_url ?? m.storage_url} alt={m.alt_text ?? m.caption ?? ""} loading="lazy" className="w-full transition-transform duration-500 group-hover:scale-[1.04]" />
          </button>
        ))}
      </div>
      {current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-court-950/95 p-4" role="dialog" aria-modal onClick={() => setIndex(null)}>
          <button className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Close" onClick={() => setIndex(null)}><X /></button>
          <button className="absolute left-2 z-10 grid h-11 w-11 place-items-center rounded-full bg-ball text-court-950 sm:left-6" aria-label="Previous" onClick={(e) => { e.stopPropagation(); setIndex((index! - 1 + images.length) % images.length); }}><ChevronLeft /></button>
          <figure className="max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <img src={current.storage_url} alt={current.alt_text ?? current.caption ?? ""} className="max-h-[80vh] w-auto rounded-3xl" />
            {current.caption && <figcaption className="mt-3 text-center text-sm text-white/80">{current.caption}</figcaption>}
          </figure>
          <button className="absolute right-2 z-10 grid h-11 w-11 place-items-center rounded-full bg-ball text-court-950 sm:right-6" aria-label="Next" onClick={(e) => { e.stopPropagation(); setIndex((index! + 1) % images.length); }}><ChevronRight /></button>
        </div>
      )}
    </>
  );
}
