from django.urls import include, path

urlpatterns = [
    path("", include("fedipol.ops.urls")),
]