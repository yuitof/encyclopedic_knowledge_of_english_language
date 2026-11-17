"""Private DynamoDB session records, kept outside the source cache bucket."""
import re
import time

from tailscale_node import BridgeError

SESSION_ID = re.compile(r'[a-f0-9]{32}\Z')


def condition_failed(error):
    return getattr(error, 'response', {}).get('Error', {}).get('Code') == 'ConditionalCheckFailedException'


class Jobs:
    def __init__(self, table):
        self.table = table

    def get(self, session_id):
        if not SESSION_ID.fullmatch(session_id):
            raise BridgeError('Invalid bridge session ID')
        return self.table.get_item(Key={'session_id': session_id}, ConsistentRead=True).get('Item')

    def claim(self, session_id, owner):
        try:
            result = self.table.update_item(Key={'session_id': session_id},
                UpdateExpression='SET #s = :starting, #o = :owner, heartbeat = :now',
                ConditionExpression='#s = :requested AND expires_at > :now AND stop_requested = :false AND #p = :protocol',
                ExpressionAttributeNames={'#s': 'state', '#o': 'owner', '#p': 'protocol'},
                ExpressionAttributeValues={':starting': 'starting', ':requested': 'requested',
                    ':owner': owner, ':now': int(time.time()), ':false': False, ':protocol': 'connect-v2'}, ReturnValues='ALL_NEW')
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
