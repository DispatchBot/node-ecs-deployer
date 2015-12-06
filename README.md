# AWS ECS Deployer Utility

This tool helps simplify automated docker deployments to Amazon's ECS. In short the tool will:

1. Perform a number of pre-checks that all resources are ready to be released.
1. Register a new task definition revision with ECS.
1. Update one or more services with the new revision.
1. Scale your auto-scaling group up, so that the new revision can be deployed. This is optional.
1. Wait for ECS to complete the deploy.
1. Scale your auto-scaling group back down to normal size. This is optional.

## Getting Started

```
npm install ecs-deployer --save
```

## Configuration

Under the hood we are using the NodeJS AWS SDK. You can configure your credentials [several ways](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html).

The AWS Region must be configured via an environment variable. Make sure to set `AWS_REGION` to whatever AWS region your resources are located in.

The user should have the following policy attached:
```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ecs:DescribeClusters",
                "ecs:DescribeServices",
                "ecs:DescribeTaskDefinition",
                "ecs:DescribeTasks",
                "ecs:ListServices",
                "ecs:ListTaskDefinitions",
                "ecs:ListTasks",
                "ecs:RegisterTaskDefinition",
                "ecs:UpdateService",
                "autoscaling:DescribeAutoScalingGroups",
                "autoscaling:SetDesiredCapacity"
            ],
            "Resource": [
                "*"
            ]
        }
    ]
}
```

## Usage

A sample deploy:
```
var EcsDeployer = require('ecs-deployer')

var deployer = new EcsDeployer({
  docker: {
    type: 'quay', // supported: 'quay' or 'none' (checking bypassed)
    url: 'https://quay.io/username/image-name',
    auth: ''
  },

  services: [
    {
      taskDefinition: {
        "family": "foo" // This should already exist in ECS. Required.
      },

      name: 'my-web-service', // ECS service name. Required.
      cluster: 'web', // ECS cluster name. Required.
      autoScaling: {
        name: 'my-web-autoscaling-group' // Optional
      }
    }
  ]
});

// Call deploy and give a version to deploy
deployer.deploy('1.0.0').then(function() {
  console.log('Successfully deployed')
}, function(err) {
  console.error('Failed to deploy');
  console.error(err)
});

// Optionally subscribe to progress events.
deployer.on('progress', function(e) {
  console.log(e.service.name, e.msg);
})
```

## Current limitations

* Only supports checking image tags for Quay.io
* Assumes a single region deployment.
* Assumes that all container definitions within a task definition should be updated with the given version string.
