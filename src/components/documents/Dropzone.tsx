import React, { useRef, useState } from 'react';
import { UploadCloud, Check, Loader2, X, AlertCircle, RotateCcw } from 'lucide-react';
import confetti from 'canvas-confetti';
import { processPDFFile } from '../../services/docProcessor.ts';
import { DocumentRecord, DocumentStage } from '../../types/index.ts';
import { calculateFileHash, findDocumentByHash, requestPersistentStorage } from '../../services/storage.ts';
import { useToast } from '../ui/Toast.tsx';
import { auth } from '../../lib/firebase.ts';
import { authFetch } from '../../services/apiClient.ts';

interface DropzoneProps {
  collectionId?: string;
  onUploadSuccess?: (doc: DocumentRecord) => void;
  onUploadError?: (error: string) => void;
  compact?: boolean;
}

export const Dropzone: React.FC<DropzoneProps> = ({
  collectionId,
  onUploadSuccess,
  onUploadError,
  compact = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(0);
  const [totalFilesCount, setTotalFilesCount] = useState<number>(0);
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [stepText, setStepText] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastFailedFiles, setLastFailedFiles] = useState<File[]>([]);
  const isCancelledRef = useRef<boolean>(false);
  const { showToast } = useToast();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const cancelUpload = (e: React.MouseEvent) => {
    e.stopPropagation();
    isCancelledRef.current = true;
    setIsProcessing(false);
    setProgressPercent(0);
    setStepText('');
    setUploadError('Upload cancelled by user.');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const retryLastUpload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lastFailedFiles.length > 0) {
      const filesToRetry = [...lastFailedFiles];
      setLastFailedFiles([]);
      await processFiles(filesToRetry);
    }
  };

  const processFiles = async (files: FileList | File[]) => {
    const validFiles = Array.from(files).filter((f) => {
      const name = f.name.toLowerCase();
      return name.endsWith('.pdf') || f.type === 'application/pdf';
    });

    if (validFiles.length === 0) {
      const err = 'Please upload valid PDF files (.pdf) with %PDF magic byte headers.';
      setUploadError(err);
      onUploadError?.(err);
      return;
    }

    isCancelledRef.current = false;
    setIsProcessing(true);
    setUploadError(null);
    setTotalFilesCount(validFiles.length);

    // Call navigator.storage.persist() on first upload (Requirement 2)
    requestPersistentStorage().catch(() => {});

    for (let i = 0; i < validFiles.length; i++) {
      if (isCancelledRef.current) break;
      const file = validFiles[i];
      setCurrentFileIndex(i + 1);
      setCurrentFileName(file.name);
      setProgressPercent(10);
      setStepText('Computing SHA-256 hash & validating PDF headers...');

      try {
        // SHA-256 duplicate detection
        const fileHash = await calculateFileHash(file);
        const existingDoc = await findDocumentByHash(fileHash);
        if (existingDoc && String(existingDoc.status).toLowerCase() === 'ready') {
          const dupMsg = `Duplicate detected (SHA-256): "${file.name}" is already indexed as "${existingDoc.name}".`;
          showToast({ message: dupMsg, type: 'info', duration: 4000 });
          continue;
        }

        // Check maximum upload size (50MB)
        const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
        if (file.size > MAX_UPLOAD_BYTES) {
          const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
          throw new Error(`File "${file.name}" (${sizeMB}MB) exceeds the 50MB maximum upload limit. Please optimize or compress the PDF.`);
        }

        let serverDocId: string | undefined = undefined;
        let storagePath: string | undefined = undefined;
        let storageBucket: string | undefined = undefined;
        const currentFirebaseUser = auth?.currentUser;

        // If user is authenticated with Firebase, upload PDF to secure private Supabase Storage
        if (currentFirebaseUser && !currentFirebaseUser.isAnonymous) {
          setStepText('Uploading document to private storage...');
          setProgressPercent(12);

          const formData = new FormData();
          formData.append('file', file, file.name);
          if (collectionId) {
            formData.append('collectionId', collectionId);
          }

          const uploadRes = await authFetch('/api/documents/upload', {
            method: 'POST',
            body: formData,
          });

          if (!uploadRes.ok) {
            const errData = await uploadRes.json().catch(() => ({}));
            const errMsg =
              errData.error ||
              (uploadRes.status === 401
                ? 'Your session has expired. Please sign in again.'
                : uploadRes.status === 413
                ? `File "${file.name}" exceeds the 50MB maximum upload limit.`
                : uploadRes.status === 503
                ? 'Supabase Storage is not configured on this server.'
                : `Upload failed (${uploadRes.status}): ${uploadRes.statusText}`);
            throw new Error(errMsg);
          }

          const uploadData = await uploadRes.json();
          if (uploadData?.document?.id && uploadData?.document?.storagePath) {
            serverDocId = uploadData.document.id;
            storagePath = uploadData.document.storagePath;
            storageBucket = uploadData.document.storageBucket;
          } else {
            throw new Error('Upload succeeded on storage but server returned invalid document metadata.');
          }
        }

        const processedDoc = await processPDFFile(file, file.name, {
          collectionId,
          serverDocId,
          storageBucket,
          storagePath,
          fileHash,
          userId: currentFirebaseUser?.uid,
          onProgress: (pct, msg) => {
            if (!isCancelledRef.current) {
              setProgressPercent(pct);
              setStepText(msg);
            }
          },
        });

        if (!isCancelledRef.current) {
          onUploadSuccess?.(processedDoc);

          // Small confetti burst on completion
          try {
            confetti({
              particleCount: 65,
              spread: 60,
              origin: { y: 0.65 },
              colors: ['#3a4bff', '#ff3d8b', '#c8f43a', '#ffd23f', '#14c9b0'],
            });
          } catch {
            // Ignore if canvas unavailable
          }

          // Exact requested toast message: "<name> is ready 🎉"
          showToast({
            message: `${file.name} is ready 🎉`,
            type: 'success',
            duration: 4500,
          });
        }
      } catch (err: any) {
        if (!isCancelledRef.current) {
          console.error(`Failed to process ${file.name}:`, err);
          const errMessage = `${file.name}: ${err.message || 'Processing failed'}`;
          setUploadError(errMessage);
          setLastFailedFiles((prev) => [...prev, file]);
          onUploadError?.(errMessage);
        }
      }
    }

    setIsProcessing(false);
    setProgressPercent(0);
    setCurrentFileName('');
    setStepText('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(e.target.files);
    }
  };

  const getActiveStep = (): DocumentStage => {
    if (progressPercent >= 100) return 'Ready';
    if (progressPercent > 55) return 'Embed';
    if (progressPercent > 35) return 'Split';
    return 'Read';
  };

  const activeStage = getActiveStep();
  const stages: Array<{ id: DocumentStage; label: string }> = [
    { id: 'Read', label: 'Read' },
    { id: 'Split', label: 'Split' },
    { id: 'Embed', label: 'Embed' },
    { id: 'Ready', label: 'Ready' },
  ];

  return (
    <div
      style={{
        borderRadius: '40px',
        background: 'var(--card)',
        boxShadow: 'var(--sh)',
      }}
      className="w-full overflow-hidden p-6 sm:p-8 border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] reveal"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isProcessing && fileInputRef.current?.click()}
        style={{
          borderRadius: '32px',
        }}
        className={`spot relative border-2 border-dashed transition-all duration-200 cursor-pointer text-center select-none ${
          isDragging
            ? 'border-[var(--a1)] bg-[var(--a1)]/10 scale-[1.01]'
            : 'border-[color-mix(in_srgb,var(--mute)_25%,transparent)] hover:border-[var(--a1)] bg-[color-mix(in_srgb,var(--card)_95%,var(--ink))]'
        } ${compact ? 'p-6' : 'p-8 sm:p-10'}`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !isProcessing) {
            fileInputRef.current?.click();
          }
        }}
        aria-label="Upload PDF documents"
      >
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center space-y-4">
            {/* 84px circular progress ring with 64px inner circle */}
            <div
              className="relative flex items-center justify-center shrink-0 shadow-md transition-all"
              style={{
                width: '84px',
                height: '84px',
                borderRadius: '50%',
                background: `conic-gradient(var(--a2) ${progressPercent}%, rgba(0,0,0,.1) 0%)`,
              }}
            >
              <div
                className="flex flex-col items-center justify-center mono font-extrabold text-xs text-[var(--ink)]"
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: 'var(--card)',
                }}
              >
                <span>{progressPercent}%</span>
              </div>
            </div>

            <div className="max-w-md px-2 text-center">
              <p className="text-sm sm:text-base font-bold text-[var(--ink)] truncate">
                File {currentFileIndex} of {totalFilesCount}: {currentFileName}
              </p>
              <p className="mono text-xs text-[var(--mute)] mt-1 truncate">{stepText}</p>
            </div>

            {/* Stage Pills: Read / Split / Embed / Ready (finished = lime) */}
            <div className="flex items-center gap-2 flex-wrap justify-center pt-1">
              {stages.map((st) => {
                const isCurrent = activeStage === st.id;
                const isDone =
                  (st.id === 'Read' && (activeStage === 'Split' || activeStage === 'Embed' || activeStage === 'Ready')) ||
                  (st.id === 'Split' && (activeStage === 'Embed' || activeStage === 'Ready')) ||
                  (st.id === 'Embed' && activeStage === 'Ready') ||
                  (st.id === 'Ready' && progressPercent >= 100);

                const bg = isDone
                  ? 'var(--lime)'
                  : isCurrent
                  ? 'var(--sun)'
                  : 'color-mix(in srgb, var(--mute) 15%, transparent)';

                return (
                  <span
                    key={st.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold mono transition-all shadow-2xs"
                    style={{
                      background: bg,
                      color: 'var(--ink)',
                      animation: isCurrent ? 'pop .35s infinite alternate' : 'none',
                    }}
                  >
                    {isDone && <Check size={11} className="stroke-[3]" />}
                    {isCurrent && <Loader2 size={11} className="animate-spin text-[var(--ink)]" />}
                    <span>{st.label}</span>
                  </span>
                );
              })}
            </div>

            {/* Cancel Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={cancelUpload}
                className="btn sm !bg-[var(--err)] cursor-pointer"
              >
                <X size={13} />
                <span>Cancel Ingestion</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-[var(--a1)]/15 to-[var(--a2)]/15 text-[var(--a1)] flex items-center justify-center shadow-xs">
              <UploadCloud size={30} />
            </div>
            <div>
              <p className="text-base sm:text-lg font-bold text-[var(--ink)]">
                Drag and drop PDF research papers here, or{' '}
                <span className="text-[var(--a1)] underline underline-offset-4 decoration-[var(--a2)]">
                  browse files
                </span>
              </p>
              <p className="text-xs text-[var(--mute)] mt-1.5 max-w-md mx-auto">
                SHA-256 duplicate detection, page-by-page partitioning, and local semantic embeddings.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Error and Retry Controls */}
      {uploadError && (
        <div className="mt-4 flex items-center justify-between gap-3 p-4 bg-[color-mix(in_srgb,var(--err)_10%,transparent)] border border-[var(--err)] rounded-3xl text-[var(--err)] text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span className="font-medium">{uploadError}</span>
          </div>
          <div className="flex items-center gap-2">
            {lastFailedFiles.length > 0 && (
              <button
                type="button"
                onClick={retryLastUpload}
                className="btn sm outline !py-1 !px-3 text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw size={12} />
                <span>Retry</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setUploadError(null)}
              className="text-[var(--err)] hover:opacity-75 font-bold p-1 cursor-pointer"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
