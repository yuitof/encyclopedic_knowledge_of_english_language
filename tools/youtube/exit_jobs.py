"""Private DynamoDB session records, kept outside the source cache bucket."""
import re
import time

from tailscale_node import ExitNodeError

SESSION_ID = re.compile(r'[a-f0-9]{32}\Z')
ACTIVE = ('requested', 'starting', 'ready')


def condition_failed(error):
    return getattr(error, 'response', {}).get('Error', {}).get('Code') == 'ConditionalCheckFailedException'


class Jobs:
    def __init__(self, table):
        self.table = table

    def get(self, session_id):
        if not SESSION_ID.fullmatch(session_id):
            raise ExitNodeError('Invalid exit-node session ID')
        return self.table.get_item(Key={'session_id': session_id}, ConsistentRead=True).get('Item')

    def create(self, session_id, seconds):
        stamp = int(time.time())
        self.table.put_item(Item={'session_id': session_id, 'state': 'requested',
            'created_at': stamp, 'expires_at': stamp + seconds, 'purge_at': stamp + 86400,
            'stop_requested': False}, ConditionExpression='attribute_not_exists(session_id)')

    def claim(self, session_id, owner):
        try:
            result = self.table.update_item(Key={'session_id': session_id},
                UpdateExpression='SET #s = :starting, #o = :owner, heartbeat = :now',
                ConditionExpression='#s = :requested AND expires_at > :now AND stop_requested = :false',
                ExpressionAttributeNames={'#s': 'state', '#o': 'owner'},
                ExpressionAttributeValues={':starting': 'starting', ':requested': 'requested',
                    ':owner': owner, ':now': int(time.time()), ':false': False}, ReturnValues='ALL_NEW')
            return result['Attributes']
        except Exception as error:
            if condition_failed(error):
                return None  # Async invocation can deliver the same event more than once.
            raise

    def publish(self, session_id, owner, **fields):
        names = {'#o': 'owner'}
        values = {':owner': owner}
        updates = []
        for i, (key, value) in enumerate(fields.items()):
            names[f'#f{i}'] = key
            values[f':v{i}'] = value
            updates.append(f'#f{i} = :v{i}')
        self.table.update_item(Key={'session_id': session_id},
            UpdateExpression='SET ' + ', '.join(updates), ConditionExpression='#o = :owner',
            ExpressionAttributeNames=names, ExpressionAttributeValues=values)

    def stop(self, session_id):
        try:
            self.table.update_item(Key={'session_id': session_id},
                UpdateExpression='SET stop_requested = :true',
                ConditionExpression='attribute_exists(session_id)',
                ExpressionAttributeValues={':true': True})
        except Exception as error:
            if not condition_failed(error):
                raise


def check_ready(job, reserve=0):
    stamp = time.time()
    if (not job or job.get('state') != 'ready' or job.get('stop_requested')
            or float(job.get('expires_at', 0)) - stamp <= reserve
            or stamp - float(job.get('heartbeat', 0)) > 20):
        raise ExitNodeError('Exit-node session is unavailable or expired; progress can be resumed')
