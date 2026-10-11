"""Canonical PostgreSQL backup. Usage: python scripts/backup.py --out backup.dump"""
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.api.config import load_settings
from backend.api.store import Store

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    store = Store(load_settings().db_path, auto_migrate=False)
    try:
        store.backup_to(args.out)
        print('PostgreSQL backup created.')
    finally:
        store.close()
