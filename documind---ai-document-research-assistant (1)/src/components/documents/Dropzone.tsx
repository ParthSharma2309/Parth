import React, { useRef, useState } from 'react';
import { UploadCloud, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { processDocumentFile } from '../../services/docProcessor.ts';
import { DocumentRecord } from '../../types/index.ts';

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

  const processFiles = async (files: FileList | File[]) => {
    const validFiles = Array.from(files).filter((f) => {
      const name = f.name.toLowerCase();
      return (
        name.endsWith('.pdf') ||
        f.type === 'application/pdf' ||
        f.type.startsWith('image/') ||
        /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)
      );
    });

    if (validFiles.length === 0) {
      const err = 'Please select valid PDF files (.pdf) or document images (.png, .jpg, .webp).';
      setUploadError(err);
      onUploadError?.(err);
      return;
    }

    setIsProcessing(true);
    setUploadError(null);
    setTotalFilesCount(validFiles.length);

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      setCurrentFileIndex(i + 1);
      setCurrentFileName(file.name);
      setProgressPercent(10);
      setStepText('Extracting content & analyzing figures with Gemini Vision...');

      try {
        const processedDoc = await processDocumentFile(file, file.name, {
          collectionId,
          onProgress: (pct, msg) => {
            setProgressPercent(pct);
            setStepText(msg);
          },
        });
        onUploadSuccess?.(processedDoc);
      } catch (err: any) {
        console.error(`Failed to process ${file.name}:`, err);
        const errMessage = `${file.name}: ${err.message || 'Processing failed'}`;
        setUploadError(errMessage);
        onUploadError?.(errMessage);
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

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,application/pdf,image/png,image/jpeg,image/webp,image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isProcessing && fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-[4px] transition-all duration-150 cursor-pointer text-center select-none ${
          isDragging
            ? 'border-[#ff4d00] bg-[#ff4d00]/10 shadow-xs'
            : 'border-[rgba(242,239,235,0.15)] hover:border-[#ff4d00] bg-[#18181a] hover:bg-[#1e1e21]'
        } ${compact ? 'p-5' : 'p-8'}`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !isProcessing) {
            fileInputRef.current?.click();
          }
        }}
        aria-label="Upload PDF documents or images"
      >
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="w-9 h-9 rounded-[2px] bg-[#ff4d00]/15 border border-[#ff4d00]/30 flex items-center justify-center text-[#ff4d00]">
              <Loader2 size={20} className="animate-spin" />
            </div>
            <div className="max-w-full px-2">
              <p className="text-sm font-semibold font-syne uppercase tracking-tight text-[#f2efeb] break-all sm:break-words">
                Processing {currentFileIndex} of {totalFilesCount}: {currentFileName}
              </p>
              <p className="text-xs font-mono text-[#f2efeb]/60 mt-0.5 break-all sm:break-words">{stepText}</p>
            </div>
            {/* Progress bar */}
            <div className="w-full max-w-xs bg-[rgba(242,239,235,0.1)] rounded-[2px] h-1.5 overflow-hidden">
              <div
                className="bg-[#ff4d00] h-1.5 rounded-[2px] transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="font-mono text-xs text-[#ff4d00] font-semibold">{progressPercent}%</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-2">
            <div className="w-10 h-10 rounded-[2px] bg-[#ff4d00]/10 border border-[#ff4d00]/30 flex items-center justify-center text-[#ff4d00] mb-1">
              <UploadCloud size={20} />
            </div>
            <div>
              <p className="text-sm font-medium text-[#f2efeb]">
                Drop PDF documents, scanned files, or images here, or <span className="text-[#ff4d00] underline font-semibold">browse files</span>
              </p>
              <p className="text-xs font-mono text-[#f2efeb]/50 mt-1">
                Supports PDFs with embedded diagrams, scanned texts, and images (PNG, JPG) · IndexedDB persistence · Multimodal Gemini analysis
              </p>
            </div>
          </div>
        )}
      </div>

      {uploadError && (
        <div className="mt-2.5 flex items-start gap-2 p-3 bg-[#ef4444]/15 border border-[#ef4444]/30 rounded-[4px] text-[#f87171] text-xs font-mono">
          <AlertCircle size={15} className="shrink-0 mt-0.5 text-[#ef4444]" />
          <div className="flex-1">
            <span className="font-semibold text-white">Ingestion Notice: </span>
            {uploadError}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setUploadError(null);
            }}
            className="text-[#f87171] hover:text-white text-sm font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
