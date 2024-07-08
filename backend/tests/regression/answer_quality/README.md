# Search Quality Test Script

This Python script automates the process of running search quality tests for a backend system.

## Features

- Loads configuration from a YAML file
- Sets up Docker environment
- Manages environment variables
- Switches to specified Git branch
- Uploads test documents
- Runs search quality tests using Relari
- Cleans up Docker containers (optional)

## Usage

1. Ensure you have the required dependencies installed.
2. Configure the `search_test_config.yaml` file based on the `search_test_config.yaml.template` file.
3. Configure the `.env_eval` file with the correct environment variables.
4. Navigate to the answer_quality folder:
```
cd danswer/backend/tests/regression/answer_quality
```
4. Run the script:
```
python search_quality_test.py
```

## Configuration

Edit `search_test_config.yaml` to set:

- output_folder
    This is the folder where the folders for each test will go 
    These folders will contain the postgres/vespa data as well as the results for each test
- zipped_documents_file
    The path to the zip file containing the files you'd like to test against
- questions_file
    The path to the yaml containing the questions you'd like to test with 
- branch
    Set the branch to null if you want it to just use the code as is
- clean_up_docker_containers
    Set this to true to automatically delete all docker containers, networks and volumes after the test
- launch_web_ui
    Set this to true if you want to use the UI during/after the testing process
- use_cloud_gpu
    Set to true or false depending on if you want to use the remote gpu
    Only need to set this if use_cloud_gpu is true
- model_server_ip
    This is the ip of the remote model server
    Only need to set this if use_cloud_gpu is true   
- model_server_port
    This is the port of the remote model server
    Only need to set this if use_cloud_gpu is true
- existing_test_suffix
    Use this if you would like to relaunch a previous test instance
    Input the suffix of the test you'd like to re-launch 
    (E.g. to use the data from folder "test_1234_5678" put "_1234_5678")
    No new files will automatically be uploaded
    Leave empty to run a new test
- limit
    Max number of questions you'd like to ask against the dataset
    Set to null for no limit
- llm
    Fill this out according to the normal LLM seeding


To restart the evaluation using a particular index, set the suffix and turn off clean_up_docker_containers.
This also will skip running the evaluation questions, in this case, the relari.py script can be run manually.


Docker daemon must be running for this to work. 

Each script is able to be individually run to upload additional docs or run additional tests