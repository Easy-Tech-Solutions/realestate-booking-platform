import React, { useRef, useState } from 'react';
import { Flag, Upload, X } from 'lucide-react';
import { reportsAPI } from '../../services/api.service';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { toast } from 'sonner';

type ContentType = 'user' | 'listing' | 'review' | 'message';
type ReportType =
  | 'scam'
  | 'fake_listing'
  | 'inappropriate_content'
  | 'harassment'
  | 'wrong_info'
  | 'other';

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  user: 'User',
  listing: 'Listing',
  review: 'Review',
  message: 'Message',
};

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  scam: 'Scam / Fraud',
  fake_listing: 'Fake Listing',
  inappropriate_content: 'Inappropriate Content',
  harassment: 'Harassment',
  wrong_info: 'Wrong Information',
  other: 'Other',
};

interface ReportDialogProps {
  defaultContentType?: ContentType;
  reportedUserId?: string | number;
  reportedListingId?: string | number;
  reportedReviewId?: string | number;
  reportedMessageId?: string | number;
  triggerLabel?: string;
  triggerVariant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive';
  className?: string;
}

export function ReportDialog({
  defaultContentType = 'listing',
  reportedUserId,
  reportedListingId,
  reportedReviewId,
  reportedMessageId,
  triggerLabel = 'Report',
  triggerVariant = 'outline',
  className,
}: ReportDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [contentType, setContentType] = useState<ContentType>(defaultContentType);
  const [reportType, setReportType] = useState<ReportType>('other');
  const [description, setDescription] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const knownTargetId = (() => {
    switch (contentType) {
      case 'user':    return reportedUserId;
      case 'listing': return reportedListingId;
      case 'review':  return reportedReviewId;
      case 'message': return reportedMessageId;
    }
  })();

  const handleScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('Screenshot must be under 10 MB'); return; }
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshot(file);
    setScreenshotPreview(URL.createObjectURL(file));
    e.target.value = '';
  };

  const removeScreenshot = () => {
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshot(null);
    setScreenshotPreview(null);
  };

  const reset = () => {
    setDescription('');
    setOwnerName('');
    removeScreenshot();
    setReportType('other');
  };

  const submit = async () => {
    if (!description.trim()) {
      toast.error('Please describe the issue.');
      return;
    }

    const payload: Record<string, any> = {
      content_type: contentType,
      report_type: reportType,
      description,
      owner_name: ownerName.trim(),
    };

    if (knownTargetId) {
      if (contentType === 'user')    payload.reported_user    = Number(knownTargetId);
      if (contentType === 'listing') payload.reported_listing = Number(knownTargetId);
      if (contentType === 'review')  payload.reported_review  = Number(knownTargetId);
      if (contentType === 'message') payload.reported_message = Number(knownTargetId);
    }

    setSubmitting(true);
    try {
      await reportsAPI.create(payload, screenshot ?? undefined);
      toast.success('Report submitted. Thank you for helping keep the platform safe.');
      reset();
      setOpen(false);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm" className={className}>
          <Flag className="w-4 h-4 mr-2" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report Content</DialogTitle>
          <DialogDescription>
            Reports are reviewed by admins. Please provide clear details.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Content type */}
          <div className="space-y-2">
            <Label>What are you reporting?</Label>
            <Select value={contentType} onValueChange={(v: ContentType) => setContentType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.entries(CONTENT_TYPE_LABELS) as [ContentType, string][]).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Owner name — shown when no known target ID */}
          {!knownTargetId && (
            <div className="space-y-2">
              <Label>
                {contentType === 'user' ? 'Name of the user' : 'Name of the listing owner'}
                <span className="text-muted-foreground text-xs ml-1">(optional)</span>
              </Label>
              <Input
                placeholder={contentType === 'user' ? 'e.g. John Doe' : 'e.g. Sarah Smith'}
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
              />
            </div>
          )}

          {/* Screenshot upload — shown when no known target ID */}
          {!knownTargetId && (
            <div className="space-y-2">
              <Label>
                Screenshot
                <span className="text-muted-foreground text-xs ml-1">(optional but helpful)</span>
              </Label>
              {screenshotPreview ? (
                <div className="relative inline-block">
                  <img
                    src={screenshotPreview}
                    alt="Screenshot preview"
                    className="w-full max-h-48 object-contain rounded-lg border border-border"
                  />
                  <button
                    type="button"
                    onClick={removeScreenshot}
                    className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/80"
                    aria-label="Remove screenshot"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-6 text-sm text-muted-foreground hover:border-foreground transition-colors"
                >
                  <Upload className="w-5 h-5" />
                  Click to upload a screenshot
                  <span className="text-xs">PNG, JPG up to 10 MB</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleScreenshotChange}
              />
            </div>
          )}

          {/* Reason */}
          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reportType} onValueChange={(v: ReportType) => setReportType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.entries(REPORT_TYPE_LABELS) as [ReportType, string][]).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Description <span className="text-destructive">*</span></Label>
            <Textarea
              placeholder="Describe what happened and why this should be reviewed"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>

          <Button onClick={submit} disabled={submitting} className="w-full">
            {submitting ? 'Submitting...' : 'Submit Report'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
