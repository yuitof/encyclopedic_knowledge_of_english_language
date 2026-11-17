"""Client half of the connect-v1 DynamoDB session contract."""
import hashlib
import re
import time

from bridge_transport import BridgeError

SESSION_ID = re.compile(r'[a-f0-9]{32}\Z')


class Jobs:
    def __init__(self, table):
        self.table = table

    def get(self, session_id):
        if not SESSION_ID.fullmatch(session_id):
            raise BridgeError('Invalid bridge session ID')
        return self.table.get_item(Key={'session_id': session_id}, ConsistentRead=True).get('Item')

    def create(self, session_id, seconds, token):
        stamp = int(time.time())
        self.table.put_item(Item={'session_id': session_id, 'state': 'requested',
            'protocol': 'connect-v1', 'proxy_token_hash': hashlib.sha256(token.encode()).hexdigest(),
            'created_at': stamp, 'expires_at': stamp + seconds, 'purge_at': stamp + 86400,
            'stop_requested': False}, ConditionExpression='attribute_not_exists(session_id)')

    def stop(self, session_id):
        try:
            self.table.update_item(Key={'session_id': session_id},
                UpdateExpression='SET stop_requested = :true',
                ConditionExpression='attribute_exists(session_id)',
                ExpressionAttributeValues={':true': True})
        except Exception as error:
            if getattr(error, 'response', {}).get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
                raise


def check_ready(job, reserve=0):
    stamp = time.time()
    if (not job or job.get('protocol') != 'connect-v1' or job.get('state') != 'ready'
            or job.get('stop_requested') or float(job.get('expires_at', 0)) - stamp <= reserve
            or stamp - float(job.get('heartbeat', 0)) > 20):
        raise BridgeError('Bridge session is stale, stopped, or near expiry')
