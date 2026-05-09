import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Pencil, Trash2, BedDouble, Users, Check, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Separator } from '../components/ui/separator';
import { toast } from 'sonner';
import { propertiesAPI } from '../../services/api.service';
import { formatCurrency } from '../../core/utils';
import type { HotelRoom } from '../../core/types';

const ROOM_TYPES = [
  { value: 'standard', label: 'Standard' },
  { value: 'deluxe', label: 'Deluxe' },
  { value: 'suite', label: 'Suite' },
  { value: 'family', label: 'Family' },
  { value: 'studio', label: 'Studio' },
  { value: 'penthouse', label: 'Penthouse' },
];

const BED_TYPES = [
  { value: 'king', label: 'King' },
  { value: 'queen', label: 'Queen' },
  { value: 'twin', label: 'Twin' },
  { value: 'double', label: 'Double' },
  { value: 'single', label: 'Single' },
  { value: 'bunk', label: 'Bunk' },
];

const ROOM_AMENITIES = [
  { id: 'wifi', name: 'Wifi' },
  { id: 'minibar', name: 'Minibar' },
  { id: 'safe', name: 'In-room safe' },
  { id: 'ac', name: 'Air conditioning' },
  { id: 'tv', name: 'TV' },
  { id: 'balcony', name: 'Balcony' },
  { id: 'jacuzzi', name: 'Jacuzzi' },
  { id: 'bathtub', name: 'Bathtub' },
  { id: 'room-service', name: 'Room service' },
  { id: 'ocean-view', name: 'Ocean view' },
  { id: 'city-view', name: 'City view' },
  { id: 'garden-view', name: 'Garden view' },
  { id: 'kitchenette', name: 'Kitchenette' },
  { id: 'living-area', name: 'Separate living area' },
  { id: 'workspace', name: 'Work desk' },
];

const emptyForm = {
  name: '',
  roomType: 'standard' as HotelRoom['roomType'],
  description: '',
  pricePerNight: '',
  maxOccupancy: '2',
  beds: '1',
  bedType: 'queen' as HotelRoom['bedType'],
  bathrooms: '1',
  amenities: [] as string[],
  totalCount: '1',
  isActive: true,
};

type FormState = typeof emptyForm;

function RoomForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: FormState;
  onSave: (data: FormState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const toggle = (amenity: string) =>
    setForm(f => ({
      ...f,
      amenities: f.amenities.includes(amenity)
        ? f.amenities.filter(a => a !== amenity)
        : [...f.amenities, amenity],
    }));

  return (
    <div className="border border-border rounded-xl p-6 space-y-5 bg-card">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="room-name">Room name *</Label>
          <Input
            id="room-name"
            placeholder="e.g. Deluxe Ocean View"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="room-type">Room type *</Label>
          <select
            id="room-type"
            value={form.roomType}
            onChange={e => setForm(f => ({ ...f, roomType: e.target.value as HotelRoom['roomType'] }))}
            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {ROOM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="room-desc">Description</Label>
        <Textarea
          id="room-desc"
          placeholder="Describe this room type..."
          rows={3}
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="price">Price per night *</Label>
          <Input
            id="price"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.pricePerNight}
            onChange={e => setForm(f => ({ ...f, pricePerNight: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="count">Room inventory *</Label>
          <Input
            id="count"
            type="number"
            min="1"
            value={form.totalCount}
            onChange={e => setForm(f => ({ ...f, totalCount: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="occupancy">Max occupancy</Label>
          <Input
            id="occupancy"
            type="number"
            min="1"
            value={form.maxOccupancy}
            onChange={e => setForm(f => ({ ...f, maxOccupancy: e.target.value }))}
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="beds">Beds</Label>
          <Input
            id="beds"
            type="number"
            min="1"
            value={form.beds}
            onChange={e => setForm(f => ({ ...f, beds: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bed-type">Bed type</Label>
          <select
            id="bed-type"
            value={form.bedType}
            onChange={e => setForm(f => ({ ...f, bedType: e.target.value as HotelRoom['bedType'] }))}
            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {BED_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bathrooms">Bathrooms</Label>
          <Input
            id="bathrooms"
            type="number"
            min="1"
            value={form.bathrooms}
            onChange={e => setForm(f => ({ ...f, bathrooms: e.target.value }))}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Room amenities</Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ROOM_AMENITIES.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => toggle(a.name)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                form.amenities.includes(a.name)
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border hover:border-primary/60'
              }`}
            >
              {form.amenities.includes(a.name) && <Check className="w-3 h-3 shrink-0" />}
              {a.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="is-active"
          type="checkbox"
          checked={form.isActive}
          onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
          className="h-4 w-4 rounded border-border"
        />
        <Label htmlFor="is-active">Active (visible to guests)</Label>
      </div>

      <div className="flex gap-3 pt-2">
        <Button
          disabled={saving || !form.name.trim() || !form.pricePerNight}
          onClick={() => onSave(form)}
        >
          {saving ? 'Saving…' : 'Save room'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function ManageRooms() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [editingRoom, setEditingRoom] = useState<HotelRoom | null>(null);

  const roomsQuery = useQuery({
    queryKey: ['hotel-rooms', id],
    queryFn: () => propertiesAPI.getRooms(id!),
    enabled: Boolean(id),
  });

  const listingQuery = useQuery({
    queryKey: ['listing-title', id],
    queryFn: () => propertiesAPI.getById(id!),
    enabled: Boolean(id),
  });

  const createMutation = useMutation({
    mutationFn: (form: FormState) =>
      propertiesAPI.createRoom(id!, {
        name: form.name,
        roomType: form.roomType,
        description: form.description,
        pricePerNight: parseFloat(form.pricePerNight),
        maxOccupancy: parseInt(form.maxOccupancy),
        beds: parseInt(form.beds),
        bedType: form.bedType,
        bathrooms: parseInt(form.bathrooms),
        amenities: form.amenities,
        totalCount: parseInt(form.totalCount),
        isActive: form.isActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-rooms', id] });
      queryClient.invalidateQueries({ queryKey: ['property', id] });
      setShowForm(false);
      toast.success('Room added successfully');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to add room'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ roomId, form }: { roomId: string; form: FormState }) =>
      propertiesAPI.updateRoom(id!, roomId, {
        name: form.name,
        roomType: form.roomType,
        description: form.description,
        pricePerNight: parseFloat(form.pricePerNight),
        maxOccupancy: parseInt(form.maxOccupancy),
        beds: parseInt(form.beds),
        bedType: form.bedType,
        bathrooms: parseInt(form.bathrooms),
        amenities: form.amenities,
        totalCount: parseInt(form.totalCount),
        isActive: form.isActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-rooms', id] });
      queryClient.invalidateQueries({ queryKey: ['property', id] });
      setEditingRoom(null);
      toast.success('Room updated successfully');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update room'),
  });

  const deleteMutation = useMutation({
    mutationFn: (roomId: string) => propertiesAPI.deleteRoom(id!, roomId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-rooms', id] });
      queryClient.invalidateQueries({ queryKey: ['property', id] });
      toast.success('Room deleted');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to delete room'),
  });

  const rooms = roomsQuery.data ?? [];
  const listing = listingQuery.data;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-8 max-w-3xl">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">Manage Rooms</h1>
            {listing && (
              <p className="text-sm text-muted-foreground">{listing.title}</p>
            )}
          </div>
        </div>

        {/* Add room button */}
        {!showForm && !editingRoom && (
          <Button onClick={() => setShowForm(true)} className="mb-6 gap-2">
            <Plus className="w-4 h-4" />
            Add room type
          </Button>
        )}

        {/* Add room form */}
        {showForm && !editingRoom && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3">New room type</h2>
            <RoomForm
              initial={emptyForm}
              onSave={(form) => createMutation.mutate(form)}
              onCancel={() => setShowForm(false)}
              saving={createMutation.isPending}
            />
          </div>
        )}

        <Separator className="mb-6" />

        {/* Room list */}
        {roomsQuery.isLoading ? (
          <p className="text-muted-foreground">Loading rooms…</p>
        ) : rooms.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="mb-2">No rooms added yet.</p>
            <p className="text-sm">Add room types so guests can select and book specific rooms.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {rooms.map(room => (
              <div key={room.id}>
                {editingRoom?.id === room.id ? (
                  <div>
                    <h2 className="text-lg font-semibold mb-3">Edit room</h2>
                    <RoomForm
                      initial={{
                        name: room.name,
                        roomType: room.roomType,
                        description: room.description,
                        pricePerNight: String(room.pricePerNight),
                        maxOccupancy: String(room.maxOccupancy),
                        beds: String(room.beds),
                        bedType: room.bedType,
                        bathrooms: String(room.bathrooms),
                        amenities: room.amenities,
                        totalCount: String(room.totalCount),
                        isActive: room.isActive,
                      }}
                      onSave={(form) => updateMutation.mutate({ roomId: room.id, form })}
                      onCancel={() => setEditingRoom(null)}
                      saving={updateMutation.isPending}
                    />
                  </div>
                ) : (
                  <div className="border border-border rounded-xl p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold">{room.name}</h3>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                            {room.roomType}
                          </span>
                          {!room.isActive && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">Inactive</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-1 flex-wrap">
                          <span className="flex items-center gap-1">
                            <BedDouble className="w-3.5 h-3.5" /> {room.beds} {room.bedType} bed{room.beds > 1 ? 's' : ''}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" /> Up to {room.maxOccupancy} guests
                          </span>
                          <span>{room.bathrooms} bath{room.bathrooms !== 1 ? 's' : ''}</span>
                          <span>{room.totalCount} room{room.totalCount !== 1 ? 's' : ''} (inventory)</span>
                        </div>
                        {room.description && (
                          <p className="text-sm text-muted-foreground">{room.description}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold">{formatCurrency(room.pricePerNight)}<span className="text-sm font-normal text-muted-foreground"> / night</span></p>
                        <div className="flex gap-2 mt-2 justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setEditingRoom(room); setShowForm(false); }}
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (window.confirm(`Delete "${room.name}"? This cannot be undone.`)) {
                                deleteMutation.mutate(room.id);
                              }
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
