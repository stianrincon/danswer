from datetime import datetime
from datetime import timezone

from sqlalchemy.orm import Session

from danswer.background.task_utils import name_cc_cleanup_task
from danswer.background.task_utils import name_cc_prune_task
from danswer.background.task_utils import name_document_set_sync_task
from danswer.connectors.interfaces import BaseConnector
from danswer.connectors.interfaces import IdConnector
from danswer.connectors.interfaces import LoadConnector
from danswer.connectors.interfaces import PollConnector
from danswer.db.engine import get_db_current_time
from danswer.db.models import Connector
from danswer.db.models import Credential
from danswer.db.models import DocumentSet
from danswer.db.tasks import check_live_task_not_timed_out
from danswer.db.tasks import get_latest_task
from danswer.server.documents.models import DeletionAttemptSnapshot
from danswer.utils.logger import setup_logger

logger = setup_logger()


def get_deletion_status(
    connector_id: int, credential_id: int, db_session: Session
) -> DeletionAttemptSnapshot | None:
    cleanup_task_name = name_cc_cleanup_task(
        connector_id=connector_id, credential_id=credential_id
    )
    task_state = get_latest_task(task_name=cleanup_task_name, db_session=db_session)

    if not task_state:
        return None

    return DeletionAttemptSnapshot(
        connector_id=connector_id,
        credential_id=credential_id,
        status=task_state.status,
    )


def should_sync_doc_set(document_set: DocumentSet, db_session: Session) -> bool:
    if document_set.is_up_to_date:
        return False

    task_name = name_document_set_sync_task(document_set.id)
    latest_sync = get_latest_task(task_name, db_session)

    if latest_sync and check_live_task_not_timed_out(latest_sync, db_session):
        logger.info(f"Document set '{document_set.id}' is already syncing. Skipping.")
        return False

    logger.info(f"Document set {document_set.id} syncing now!")
    return True


def should_prune_cc_pair(
    connector: Connector, credential: Credential, db_session: Session
) -> bool:
    if not connector.prune_freq:
        return False

    pruning_task_name = name_cc_prune_task(
        connector_id=connector.id, credential_id=credential.id
    )
    last_pruning_task = get_latest_task(pruning_task_name, db_session)
    current_db_time = get_db_current_time(db_session)

    if not last_pruning_task:
        time_since_initialization = current_db_time - connector.time_created
        if time_since_initialization.total_seconds() >= connector.prune_freq:
            return True
        return False

    if check_live_task_not_timed_out(last_pruning_task, db_session):
        logger.info(f"Connector '{connector.name}' is already pruning. Skipping.")
        return False

    if not last_pruning_task.start_time:
        return False

    time_since_last_pruning = current_db_time - last_pruning_task.start_time
    return time_since_last_pruning.total_seconds() >= connector.prune_freq


def extract_ids_from_runnable_connector(runnable_connector: BaseConnector) -> set[str]:
    """
    If the PruneConnector hasnt been implemented for the given connector, just pull
    all docs using the load_from_state and grab out the IDs
    """
    all_connector_doc_ids: set[str] = set()
    if isinstance(runnable_connector, IdConnector):
        all_connector_doc_ids = runnable_connector.retrieve_all_source_ids()
    elif isinstance(runnable_connector, LoadConnector):
        doc_batch_generator = runnable_connector.load_from_state()
        for doc_batch in doc_batch_generator:
            all_connector_doc_ids.update(doc.id for doc in doc_batch)
    elif isinstance(runnable_connector, PollConnector):
        start = datetime(1970, 1, 1, tzinfo=timezone.utc).timestamp()
        end = datetime.now(timezone.utc).timestamp()
        doc_batch_generator = runnable_connector.poll_source(start=start, end=end)
        for doc_batch in doc_batch_generator:
            all_connector_doc_ids.update(doc.id for doc in doc_batch)
    else:
        raise RuntimeError("Pruning job could not find a valid runnable_connector.")

    return all_connector_doc_ids
