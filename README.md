= AWS ECS Deployer Utility

This tool helps simplify automated docker deployments to Amazon's ECS. In short the tool will:

1. Perform a number of pre-checks that all resources are ready to be released.
1. Register a new task definition revision with ECS.
1. Update one or more services with the new revision.
1. Scale your auto-scaling group up, so that the new revision can be deployed. This is optional.
1. Wait for ECS to complete the deploy.
1. Scale your auto-scaling group back down to normal size. This is optional.

== Getting Started

```
npm install ecs-deployer --save
```

A sample deploy:
```
var EcsDeployer = require('ecs-deployer')

var deployer = new EcsDeployer({
  docker: {
    url: 'https://quay.io/username/image-name'
    auth: ''
  },

  services: [
    {
      taskDefinitionLocation: 's3://example/ecs-task-definition.json',
      name: 'my-web-service', // ECS service name. Must exist.
      cluster: 'web', // ECS cluster name. Must exist.
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

Current limitations:

* Only supports checking image tags for Quay.io
* Assumes you are storing your task definitions in S3
* Assumes that all container definitions within a task definition should be updated with the given version string.
