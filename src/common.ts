import { subscription } from "@pulumi/azure-native";
import * as resources from "@pulumi/azure-native/resources"
import * as pulumi from "@pulumi/pulumi"

export const env = pulumi.getStack();
export const projectName = pulumi.getProject();
export const projectConfig = new pulumi.Config('project');

export const tags = {
    'pulumi:name': pulumi.getProject(),
    'pulumi:url': projectConfig.require('url'),
    'pulumi:stack': pulumi.getStack(),
}

const azureNativeConfig = new pulumi.Config('azure-native');

export const location = azureNativeConfig.require('location');
export const tenantID = azureNativeConfig.require('tenantID');
export const subscriptionID = azureNativeConfig.require('subscriptionID');

const resourcesGroupName = `rg-${projectName}-${env}`
export const resourcesGroup = new resources.ResourceGroup(resourcesGroupName, {
    resourceGroupName: resourcesGroupName,
    location: location,
    tags: tags,
})