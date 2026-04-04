from django.apps import AppConfig

class UsersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'users'
<<<<<<< HEAD
<<<<<<< HEAD

    def ready(self):
        import users.signals  #This connects the signals
=======
>>>>>>> dalton
=======

    def ready(self):
        import users.signals  #This connects the signals
>>>>>>> origin/jake
