import os
from datetime import datetime
from types import SimpleNamespace

import yaml

from tests.regression.answer_quality.cli_utils import cleanup_docker
from tests.regression.answer_quality.cli_utils import manage_data_directories
from tests.regression.answer_quality.cli_utils import set_env_variables
from tests.regression.answer_quality.cli_utils import start_docker_compose
from tests.regression.answer_quality.cli_utils import switch_to_branch
from tests.regression.answer_quality.file_uploader import upload_test_files
from tests.regression.answer_quality.relari import answer_relari_questions


def load_config(config_filename: str) -> SimpleNamespace:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(current_dir, config_filename)
    with open(config_path, "r") as file:
        return SimpleNamespace(**yaml.safe_load(file))


def main() -> None:
    config = load_config("search_test_config.yaml")
    if config.existing_test_suffix:
        run_suffix = config.existing_test_suffix
        print("launching danswer with existing data suffix:", run_suffix)
    else:
        run_suffix = datetime.now().strftime("_%Y%m%d_%H%M%S")
        print("run_suffix:", run_suffix)

    set_env_variables(
        config.model_server_ip,
        config.model_server_port,
        config.use_cloud_gpu,
        config.llm,
    )
    relari_output_folder_path = manage_data_directories(
        run_suffix, config.output_folder, config.use_cloud_gpu
    )
    if config.branch:
        switch_to_branch(config.branch)

    start_docker_compose(run_suffix, config.launch_web_ui, config.use_cloud_gpu)

    if not config.existing_test_suffix:
        upload_test_files(config.zipped_documents_file, run_suffix)

        answer_relari_questions(
            config.questions_file, relari_output_folder_path, run_suffix, config.limit
        )

    if config.clean_up_docker_containers:
        cleanup_docker(run_suffix)


if __name__ == "__main__":
    main()
