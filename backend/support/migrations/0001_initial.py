import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ContactInquiry',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('email', models.EmailField(max_length=254)),
                ('category', models.CharField(
                    choices=[
                        ('general', 'General Inquiry'),
                        ('booking', 'Booking Help'),
                        ('payment', 'Payment Issue'),
                        ('listing', 'Listing Question'),
                        ('partnership', 'Partnership'),
                        ('other', 'Other'),
                    ],
                    default='general',
                    max_length=20,
                )),
                ('subject', models.CharField(max_length=200)),
                ('message', models.TextField()),
                ('is_read', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='SupportTicket',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('ticket_number', models.CharField(editable=False, max_length=30, unique=True)),
                ('guest_name', models.CharField(blank=True, max_length=100)),
                ('guest_email', models.EmailField(blank=True, max_length=254)),
                ('category', models.CharField(
                    choices=[
                        ('account', 'Account & Profile'),
                        ('booking', 'Booking Issue'),
                        ('payment', 'Payment & Refunds'),
                        ('listing', 'Listing Problem'),
                        ('safety', 'Safety Concern'),
                        ('technical', 'Technical Issue'),
                        ('host', 'Host Support'),
                        ('other', 'Other'),
                    ],
                    max_length=20,
                )),
                ('subject', models.CharField(max_length=200)),
                ('description', models.TextField()),
                ('status', models.CharField(
                    choices=[
                        ('open', 'Open'),
                        ('in_progress', 'In Progress'),
                        ('pending_user', 'Pending User Response'),
                        ('resolved', 'Resolved'),
                        ('closed', 'Closed'),
                    ],
                    default='open',
                    max_length=20,
                )),
                ('priority', models.CharField(
                    choices=[
                        ('low', 'Low'),
                        ('medium', 'Medium'),
                        ('high', 'High'),
                        ('urgent', 'Urgent'),
                    ],
                    default='medium',
                    max_length=10,
                )),
                ('resolved_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='support_tickets',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('assigned_to', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='assigned_tickets',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='TicketMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sender_name', models.CharField(blank=True, max_length=100)),
                ('is_staff_reply', models.BooleanField(default=False)),
                ('content', models.TextField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('ticket', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='messages',
                    to='support.supportticket',
                )),
                ('sender', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='ticket_messages',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['created_at'],
            },
        ),
        migrations.CreateModel(
            name='TicketAttachment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('file', models.FileField(upload_to='support/attachments/')),
                ('filename', models.CharField(max_length=255)),
                ('file_size', models.PositiveIntegerField(default=0)),
                ('content_type', models.CharField(blank=True, max_length=100)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('ticket', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='attachments',
                    to='support.supportticket',
                )),
                ('uploaded_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
        ),
    ]
