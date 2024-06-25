"""connector_advance_settings

Revision ID: 6c0e184911d8
Revises: 48d14957fe80
Create Date: 2024-06-19 17:58:22.856285

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "6c0e184911d8"
down_revision = "48d14957fe80"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns without default values
    op.add_column('connector', sa.Column('embedding_size', sa.Integer, nullable=True))
    op.add_column('connector', sa.Column('chunk_overlap', sa.Integer, nullable=True))

    # Update existing rows
    op.execute("UPDATE connector SET embedding_size = 512, chunk_overlap = 0")

    # Make columns non-nullable
    op.alter_column('connector', 'embedding_size', nullable=False)
    op.alter_column('connector', 'chunk_overlap', nullable=False)

    # Add check constraints
    op.create_check_constraint(
        "check_embedding_size_positive",
        "connector",
        "embedding_size > 0"
    )
    op.create_check_constraint(
        "check_chunk_overlap_positive",
        "connector",
        "chunk_overlap >= 0"
    )


def downgrade() -> None:
    op.drop_constraint("check_embedding_size_positive", "connector", type_="check")
    op.drop_constraint("check_chunk_overlap_positive", "connector", type_="check")

    op.drop_column('connector', 'embedding_size')
    op.drop_column('connector', 'chunk_overlap')
