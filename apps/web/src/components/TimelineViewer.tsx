import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { photoUrl } from "../lib/photos";

/**
 * Visionneur plein écran : `<dialog>` modal natif (focus piégé dans la boîte, Échap pour fermer, focus rendu
 * au bouton d'origine à la fermeture), sans bibliothèque.
 */
export function TimelineViewer({ photoId, caption, alt, onClose }: { photoId: string; caption: string; alt: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={caption}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-transparent p-0 backdrop:bg-black/90"
    >
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <button
          type="button"
          autoFocus
          aria-label="Fermer la photo"
          onClick={onClose}
          className="absolute top-4 right-4 flex size-12 items-center justify-center rounded-full bg-white/15 text-white active:opacity-70"
        >
          <Icon name="x" />
        </button>
        <img src={photoUrl(photoId)} alt={alt} className="max-h-[80dvh] max-w-full rounded-md object-contain" />
        <p className="text-label text-white">{caption}</p>
      </div>
    </dialog>
  );
}
