"""Build the pinned experimental two-movie override outside the client tree."""
import argparse
import json
import sys
sys.dont_write_bytecode=True
from lobby_video_settings import build

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client-root',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    print(json.dumps(build(args.client_root,args.output),indent=2))
