"""Explicit local account provisioning, migration and backup. No default credentials."""
from __future__ import annotations

import argparse
import getpass
from pathlib import Path

from .auth import provision_user
from .config import load_settings
from .store import Store
from ..core.data import load_reference


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('migrate')
    user = commands.add_parser('create-user')
    user.add_argument('--username', required=True)
    user.add_argument('--name', required=True)
    user.add_argument('--role', required=True, choices=('coordinator', 'clinical_lead', 'physician'))
    user.add_argument('--physician-id')
    backup = commands.add_parser('backup')
    backup.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    settings = load_settings()
    store = Store(settings.db_path, auto_migrate=True)
    try:
        if args.command == 'create-user':
            ref = load_reference(settings.data_dir)
            if args.physician_id and args.physician_id not in ref.physicians:
                parser.error('Physician identifier is absent from the supplied roster')
            password = getpass.getpass('Unique account password: ')
            if password != getpass.getpass('Confirm password: '):
                parser.error('Passwords differ')
            provision_user(store, username=args.username, display_name=args.name, role=args.role,
                           password=password, physician_id=args.physician_id)
            print('Account provisioned; existing sessions revoked.')
        elif args.command == 'backup':
            store.backup_to(args.output)
            print('Backup created.')
        else:
            print(f'Database ready at schema version {store.schema_version()}.')
    finally:
        store.close()


if __name__ == '__main__':
    main()
