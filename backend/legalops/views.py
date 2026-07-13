from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import LegalDocument
from .serializers import LegalDocumentSerializer


def _require_finance(request):
    """Full admins (superadmin) always pass; is_staff accounts need the
    finance department (legacy) OR a custom role granting
    finances.legal_documents directly. require_department() already
    bypasses fully for is_full_admin() users."""
    from superadmin.permissions import is_superadmin_staff, require_department
    from rbac.permissions import has_any_permission
    user = request.user
    if not is_superadmin_staff(user):
        return False
    return require_department(user, 'finance') or has_any_permission(user, 'finances.legal_documents')


@api_view(['GET'])
@permission_classes([AllowAny])
def current_documents(request):
    """Public. The latest version entry per document key — lets the static
    Terms/Privacy pages show a real 'last updated' date instead of a
    hardcoded one, without needing the document content itself to move
    into the database."""
    latest_by_key = {}
    for doc in LegalDocument.objects.order_by('document_key', '-effective_date', '-created_at'):
        latest_by_key.setdefault(doc.document_key, doc)
    return Response(LegalDocumentSerializer(list(latest_by_key.values()), many=True).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def documents_collection(request):
    if not _require_finance(request):
        return Response({'error': 'Finance & Legal access required'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'GET':
        qs = LegalDocument.objects.select_related('published_by').all()
        key_filter = request.query_params.get('document_key')
        if key_filter:
            qs = qs.filter(document_key=key_filter)
        return Response(LegalDocumentSerializer(qs, many=True).data)

    serializer = LegalDocumentSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    doc = serializer.save(published_by=request.user)

    from superadmin.permissions import log_admin_action
    log_admin_action(request, 'legal_document.publish', target=doc, reason=doc.summary_of_changes)

    return Response(LegalDocumentSerializer(doc).data, status=status.HTTP_201_CREATED)
