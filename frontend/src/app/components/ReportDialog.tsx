import React, { useMemo, useState } from 'react';
import { Flag } from 'lucide-react';
import { reportsAPI } from '../../services/api.service';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
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
  const [manualTargetId, setManualTargetId] = useState('');

  const knownTarget = useMemo(() => {
    switch (contentType) {
      case 'user':
        return reportedUserId;
      case 'listing':
        return reportedListingId;
      case 'review':
        return reportedReviewId;
      case 'message':
        return reportedMessageId;
      default:
        return undefined;
    }
  }, [contentType, reportedListingId, reportedMessageId, reportedReviewId, reportedUserId]);

  const buildPayload = () => {
    const rawTarget = knownTarget ?? manualTargetId;
    const numericTarget = Number(rawTarget);
    if (!rawTarget || Number.isNaN(numericTarget)) {
      throw new Error('A valid target ID is required for the selected content type.');
    }

    const payload: Record<string, any> = {
      content_type: contentType,
      report_type: reportType,
      description,
    };

    if (contentType === 'user') payload.reported_user = numericTarget;
    if (contentType === 'listing') payload.reported_listing = numericTarget;
    if (contentType === 'review') payload.reported_review = numericTarget;
    if (contentType === 'message') payload.reported_message = numericTarget;

    return payload;
  };

  const submit = async () => {
    if (!description.trim()) {
      toast.error('Please describe the issue.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = buildPayload();
      await reportsAPI.create(payload);
      toast.success('Report submitted. Thank you for helping keep the platform safe.');
      setDescription('');
      setManualTargetId('');
      setOpen(false);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm" className={className}>
          <Flag className="w-4 h-4 mr-2" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report Content</DialogTitle>
          <DialogDescription>
            Reports are reviewed by admins. Please provide clear details.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Content Type</Label>
            <Select value={contentType} onValueChange={(v: ContentType) => setContentType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">user</SelectItem>
                <SelectItem value="listing">listing</SelectItem>
                <SelectItem value="review">review</SelectItem>
                <SelectItem value="message">message</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!knownTarget && (
            <div className="space-y-2">
              <Label>Target ID</Label>
              <Input
                placeholder="Enter the numeric ID of the content"
                value={manualTargetId}
                onChange={(e) => setManualTargetId(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reportType} onValueChange={(v: ReportType) => setReportType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scam">scam</SelectItem>
                <SelectItem value="fake_listing">fake_listing</SelectItem>
                <SelectItem value="inappropriate_content">inappropriate_content</SelectItem>
                <SelectItem value="harassment">harassment</SelectItem>
                <SelectItem value="wrong_info">wrong_info</SelectItem>
                <SelectItem value="other">other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="Describe what happened and why this should be reviewed"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
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
