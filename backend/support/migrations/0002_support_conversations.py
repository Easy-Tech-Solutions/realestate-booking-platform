from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('support', '0001_initial'),
        ('messaging', '0002_messaging_features'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # ContactInquiry: add user FK
        migrations.AddField(
            model_name='contactinquiry',
            name='user',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='contact_inquiries',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        # ContactInquiry: add conversation FK
        migrations.AddField(
            model_name='contactinquiry',
            name='conversation',
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='contact_inquiry',
                to='messaging.conversation',
            ),
        ),
        # SupportTicket: add conversation FK
        migrations.AddField(
            model_name='supportticket',
            name='conversation',
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='support_ticket',
                to='messaging.conversation',
            ),
        ),
    ]
