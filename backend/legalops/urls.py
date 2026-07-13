from django.urls import path

from . import views

urlpatterns = [
    path('documents/current/', views.current_documents, name='legal-documents-current'),
    path('documents/', views.documents_collection, name='legal-documents-collection'),
]
