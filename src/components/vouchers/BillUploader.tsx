import React, { useState, useRef } from 'react';
import { uploadToR2, deleteFromR2 } from '@/lib/r2';
import { useUIStore } from '@/store/uiStore';
import { UploadCloud, X, Loader2, Eye, Camera, Plus, Image as ImageIcon } from 'lucide-react';
import { triggerHaptic, cn } from '@/lib/utils';
import { showToast } from '@/components/ui/ToastContainer';

interface BillUploaderProps {
  photoUrls: string[];
  onChange: (urls: string[]) => void;
  maxPhotos?: number;
}

export const BillUploader: React.FC<BillUploaderProps> = ({
  photoUrls = [],
  onChange,
  maxPhotos = 4,
}) => {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { openLightbox } = useUIStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const processFiles = async (filesList: FileList | File[]) => {
    const files = Array.from(filesList);
    if (!files || files.length === 0) return;
    setUploadError(null);

    if (photoUrls.length + files.length > maxPhotos) {
      const msg = `Maximum of ${maxPhotos} photos allowed per voucher.`;
      setUploadError(msg);
      showToast({
        type: 'error',
        title: 'Limit Exceeded',
        message: msg,
      });
      return;
    }

    const ALLOWED_BILL_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    for (const file of files) {
      if (file.type && !ALLOWED_BILL_MIMES.includes(file.type.toLowerCase())) {
        const msg = 'Only JPG, PNG, WebP, or HEIC images are allowed for bill uploads.';
        setUploadError(msg);
        showToast({
          type: 'error',
          title: 'Invalid File Type',
          message: msg,
        });
        return;
      }
    }

    const toastId = `bill-upload-${Date.now()}`;
    setUploading(true);
    triggerHaptic('light');
    showToast({
      id: toastId,
      type: 'loading',
      title: 'Uploading Attachment',
      message: `Uploading ${files.length} receipt photo(s)...`,
      durationMs: 6000,
    });

    try {
      const uploadPromises = files.map(async (file) => {
        const cloudUrl = await uploadToR2(file, 'receipts', file.name);
        if (!cloudUrl || !cloudUrl.startsWith('http') || cloudUrl.startsWith('blob:')) {
          throw new Error('Could not save receipt photo. Please try again.');
        }
        return cloudUrl;
      });

      const validUrls = await Promise.all(uploadPromises);

      if (validUrls.length > 0) {
        onChange([...photoUrls, ...validUrls]);
        triggerHaptic('success');
        showToast({
          id: toastId,
          type: 'success',
          title: 'Receipt Attached',
          message: validUrls.length === 1 
            ? 'Receipt photo saved successfully.' 
            : `${validUrls.length} receipt photos saved successfully.`,
        });
      }
    } catch (err: any) {
      console.error('Upload processing error:', err);
      const errMsg = 'Failed to upload receipt: ' + (err.message || 'Unknown error');
      setUploadError(errMsg);
      triggerHaptic('error');
      showToast({
        id: toastId,
        type: 'error',
        title: 'Upload Failed',
        message: errMsg,
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await processFiles(e.target.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files);
    }
  };

  const handleRemove = async (index: number) => {
    triggerHaptic('light');
    const urlToRemove = photoUrls[index];
    onChange(photoUrls.filter((_, idx) => idx !== index));

    showToast({
      type: 'info',
      title: 'Photo Removed',
      message: 'Receipt photo removed from voucher.',
    });

    if (urlToRemove && !urlToRemove.startsWith('data:')) {
      try {
        await deleteFromR2(urlToRemove);
      } catch (e) {
        console.warn('Background R2 delete notice:', e);
      }
    }
  };

  return (
    <div className="space-y-3 font-sans">
      {uploadError && (
        <div className="p-2.5 rounded-[6px] bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium font-sans flex items-center justify-between">
          <span>{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="text-rose-500 hover:text-rose-700 p-0.5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Thumbnails + Inline Add Tile Strip */}
      {photoUrls.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {photoUrls.map((url, idx) => (
            <div
              key={idx}
              className="relative group rounded-[6px] overflow-hidden bg-slate-100 dark:bg-[#141414] border border-slate-200/80 dark:border-[#282828] w-20 h-20 flex items-center justify-center shadow-2xs shrink-0"
            >
              <img
                src={url}
                alt={`Bill Photo #${idx + 1}`}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openLightbox(url)}
                  className="p-1 rounded-[4px] bg-white/90 dark:bg-white/20 text-slate-900 dark:text-white border border-slate-200/80 dark:border-white/10 hover:border-[#3ecf8e] cursor-pointer shadow-xs"
                  title="View Full Size"
                >
                  <Eye className="w-3.5 h-3.5 text-[#3ecf8e]" />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(idx)}
                  className="p-1 rounded-[4px] bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-xs"
                  title="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          {/* Inline Add More Buttons if limit not reached */}
          {photoUrls.length < maxPhotos && (
            <div className="flex items-center gap-2">
              <label className="w-20 h-20 rounded-[6px] border border-dashed border-slate-300 dark:border-[#2e2e2e] hover:border-[#3ecf8e] dark:hover:border-[#3ecf8e] bg-slate-50/50 dark:bg-[#141414] hover:bg-emerald-500/5 dark:hover:bg-[#3ecf8e]/5 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors text-slate-500 dark:text-[#a1a1a1] hover:text-emerald-600 dark:hover:text-[#3ecf8e] shrink-0">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  disabled={uploading}
                  className="sr-only"
                />
                <Plus className="w-4 h-4 text-[#3ecf8e] stroke-[2.5]" />
                <span className="text-[10px] font-medium font-sans">Add Photo</span>
              </label>

              <label className="h-20 px-3 rounded-[6px] border border-slate-200/80 dark:border-[#282828] hover:border-slate-300 dark:hover:border-[#383838] bg-white dark:bg-[#181818] hover:bg-slate-50 dark:hover:bg-[#202020] flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors text-slate-600 dark:text-zinc-300 shrink-0 shadow-2xs">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  disabled={uploading}
                  className="sr-only"
                />
                <Camera className="w-4 h-4 text-emerald-600 dark:text-[#3ecf8e]" />
                <span className="text-[10px] font-medium">Camera</span>
              </label>
            </div>
          )}
        </div>
      ) : (
        /* Empty State: Modern Studio Dropzone Box */
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'rounded-[8px] border border-dashed p-4 transition-all text-center flex flex-col items-center justify-center gap-3',
            isDragOver
              ? 'border-[#3ecf8e] bg-emerald-500/10 dark:bg-[#3ecf8e]/10'
              : 'border-slate-300 dark:border-[#2e2e2e] hover:border-slate-400 dark:hover:border-[#404040] bg-slate-50/60 dark:bg-[#161616]'
          )}
        >
          {/* Center Info */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-[8px] bg-slate-100 dark:bg-[#202020] text-emerald-600 dark:text-[#3ecf8e] flex items-center justify-center border border-slate-200/80 dark:border-[#2a2a2a] shrink-0 shadow-2xs">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-white font-sans">
                Attach Photo of Bill or Slip
              </p>
              <p className="text-[11px] text-slate-500 dark:text-[#a1a1a1] font-sans mt-0.5 max-w-[260px] mx-auto leading-relaxed">
                Take photo with camera or choose files (up to {maxPhotos})
              </p>
            </div>
          </div>

          {/* Action Buttons Grid */}
          <div className="grid grid-cols-2 gap-2 w-full pt-1">
            <label className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-[6px] border border-slate-200/80 dark:border-[#2a2a2a] bg-white dark:bg-[#1c1c1c] hover:bg-slate-50 dark:hover:bg-[#242424] hover:border-slate-300 dark:hover:border-[#383838] text-slate-800 dark:text-zinc-200 text-xs font-medium cursor-pointer transition-colors shadow-2xs select-none">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                disabled={uploading}
                className="sr-only"
              />
              <Camera className="w-3.5 h-3.5 text-emerald-600 dark:text-[#3ecf8e]" />
              <span>Take Photo</span>
            </label>

            <label className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-[6px] border border-slate-200/80 dark:border-[#2a2a2a] bg-white dark:bg-[#1c1c1c] hover:bg-slate-50 dark:hover:bg-[#242424] hover:border-slate-300 dark:hover:border-[#383838] text-slate-800 dark:text-zinc-200 text-xs font-medium cursor-pointer transition-colors shadow-2xs select-none">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                disabled={uploading}
                className="sr-only"
              />
              <ImageIcon className="w-3.5 h-3.5 text-slate-400 dark:text-[#8e8e8e]" />
              <span>Choose Files</span>
            </label>
          </div>
        </div>
      )}

      {uploading && (
        <div className="flex items-center gap-2 py-0.5 text-xs font-mono text-emerald-700 dark:text-[#3ecf8e] font-medium">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Saving photo...</span>
        </div>
      )}
    </div>
  );
};
