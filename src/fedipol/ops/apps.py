from django.apps import AppConfig


class OpsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "fedipol.ops"
    label = "ops"
    verbose_name = "Fedipol Betrieb"