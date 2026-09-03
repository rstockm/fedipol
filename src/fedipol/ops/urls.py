from django.urls import path

from fedipol.ops import views

urlpatterns = [
    path("", views.dashboard),
    path("healthz", views.healthz),
    path("health/data", views.health_data),
    path("fedipol_data.json", views.export_data),
    path("manifest.json", views.export_manifest),
    path("<path:relpath>", views.dashboard),
]