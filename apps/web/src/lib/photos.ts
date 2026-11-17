import { api } from "./api";
import { resizePhoto } from "./image";

export const photoUrl = (id: string, thumb = false) => `/api/photos/${id}${thumb ? "?size=thumb" : ""}`;

/** Réduit puis envoie une photo ; renvoie l'identifiant de la photo créée. */
export async function uploadPhoto(plantId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("photo", await resizePhoto(file), "photo.jpg");
  return (await api<{ id: string }>(`/api/plants/${plantId}/photos`, { method: "POST", body: form })).id;
}
