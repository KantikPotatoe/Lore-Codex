import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addImage, galleryImages, updateImageCaption, deleteImage, reorderImages, setAsPortrait,
  type LorePage,
} from '../db'
import { compressImage } from '../imageUtils'
import Lightbox from './Lightbox'

interface Props {
  page: LorePage
  editable: boolean
}

/** The "Images" section below a page body: a thumbnail grid with a lightbox.
 *  In edit mode it adds file-picker / drag-drop upload, per-image caption,
 *  delete, "set as portrait", and native drag-to-reorder. Hidden entirely in
 *  view mode when the page has no images. */
export default function ImageGallery({ page, editable }: Props) {
  // Gallery grid only — body images live in the same table (kind:'body') but are
  // positioned inside the page body, not here (#182).
  const images = useLiveQuery(() => galleryImages(page.id), [page.id]) ?? []

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const dataUrl = await compressImage(file, 1600)
      await addImage(page.id, dataUrl)
    }
  }

  function onDropFiles(e: React.DragEvent) {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }

  async function onDropThumb(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null)
      return
    }
    const ids = images.map((img) => img.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setDragId(null)
    await reorderImages(page.id, ids)
  }

  // Nothing to show and nothing to add — keep view mode clean.
  if (!editable && images.length === 0) return null

  return (
    <section className="image-gallery">
      <h2 className="gallery-heading">Images</h2>

      {editable && (
        <div
          className="gallery-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDropFiles}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          Drop images here, or click to choose files
        </div>
      )}

      <div className="gallery-grid">
        {images.map((img, i) => (
          <figure
            key={img.id}
            className="gallery-item"
            draggable={editable}
            onDragStart={() => editable && setDragId(img.id)}
            onDragOver={(e) => { if (editable) e.preventDefault() }}
            onDrop={(e) => { e.preventDefault(); if (editable) onDropThumb(img.id) }}
          >
            <button className="gallery-thumb" onClick={() => setLightboxIndex(i)}>
              <img src={img.dataUrl} alt={img.caption} />
            </button>
            {editable ? (
              <>
                <input
                  className="gallery-caption-input"
                  placeholder="caption…"
                  value={img.caption}
                  onChange={(e) => updateImageCaption(img.id, e.target.value)}
                />
                <div className="gallery-item-actions">
                  <button className="ghost-btn" onClick={() => setAsPortrait(page, img.dataUrl)} title="Use as infobox portrait">★ Portrait</button>
                  <button className="ghost-btn danger" onClick={() => deleteImage(img.id)} title="Delete image">🗑</button>
                </div>
              </>
            ) : (
              img.caption && <figcaption className="gallery-caption">{img.caption}</figcaption>
            )}
          </figure>
        ))}
      </div>

      {lightboxIndex !== null && images.length > 0 && (
        <Lightbox
          images={images}
          index={Math.min(lightboxIndex, images.length - 1)}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </section>
  )
}
