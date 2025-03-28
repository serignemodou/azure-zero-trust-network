import * as pulumi from "@pulumi/pulumi";
import * as storage from "@pulumi/azure-native/storage";
import * as random from "@pulumi/random";
import * as keyVault from "@pulumi/azure-native/keyVault";
import * as network from "@pulumi/azure-native/network";

import {resourcesGroup, env, projectName, location, tags} from './common';
import {subnet} from "./network";

interface StorageAccountParams {
    sku: string,
    kind: string
}
export const storageAccountParams = new pulumi.Config('storageAccount').requireObject<StorageAccountParams>('params')

const regEx = /-/gs
const saName = `sa-${projectName}-${env}`
let storageAccountName = saName.replace(regEx, '')

if (storageAccountName.length > 24) {
    const nbr = storageAccountName.length - 24
    storageAccountName = storageAccountName.substring(0, storageAccountName.length - nbr).substring(0, 24)
}

const randomSuffix = new random.RandomString(`kv-name-${env}`, {
    length: 3,
    upper: false,
    special: false
})

export const storageAccount = new storage.StorageAccount(storageAccountName, {
    accountName: storageAccountName,
    resourceGroupName: resourcesGroup.name,
    location: location,
    sku: {
        name: storageAccountParams.sku,
    },
    kind: storageAccountParams.kind,
    allowBlobPublicAccess: false,
    enableHttpsTrafficOnly: false, //True for prod env
    networkRuleSet: {
        defaultAction: 'Deny',
        bypass: 'Logging, Metrics, AzureServices',
        ipRules: [{
            iPAddressOrRange: "0.0.0.0/0" // IP List autoriser to access to the blob
        }], 
    },
    tags: tags
})

new storage.BlobServiceProperties('blobService', {
    accountName: storageAccount.name,
    blobServicesName: "default",
    resourceGroupName: resourcesGroup.name,
    deleteRetentionPolicy: {
        enabled: true,
        days: 7,
        allowPermanentDelete: true  // false for critical contents
    },
    isVersioningEnabled: true
})

const saContainerName = `cn-${projectName}-${env}`
export const blobContainer = new storage.BlobContainer(saContainerName, {
    resourceGroupName: resourcesGroup.name,
    accountName: storageAccount.name,
    containerName: saContainerName,
    publicAccess: 'None'
})

const startDate = new Date()
const expiryDate = new Date(startDate)
expiryDate.setMonth(startDate.getMonth() + 24)
const sasParams : storage.ListStorageAccountServiceSASOutputArgs = {
    accountName: storageAccount.name,
    resourceGroupName: resourcesGroup.name,
    protocols: 'https,http',
    permissions: 'r',
    resource: 'c',
    sharedAccessExpiryTime: expiryDate.toISOString(),
    sharedAccessStartTime: startDate.toISOString(),
    canonicalizedResource: pulumi.interpolate`/blob/${storageAccount.name}/${blobContainer.name}`
}

const sasBlobContainerToken = storage.listStorageAccountServiceSASOutput(sasParams)
const appExtension = '.js' //.htlm for html app
const sasBlobToken = sasBlobContainerToken.serviceSasToken
export const blobUri = pulumi.interpolate`/{url_path}-{query-string:8}.${appExtension}?${sasBlobToken}`

const kvSecretName = pulumi.interpolate`auth-token-${env}-${randomSuffix}`
export const secretToken = new keyVault.Secret('secret', {
    resourceGroupName: resourcesGroup.name,
    vaultName: 'ss',
    secretName: kvSecretName,
    properties: {
        value: sasBlobToken,
        attributes: {
            enabled: true,
            expires: Math.floor(expiryDate.getTime() / 1000),
        }
    }
})


const peName = `pe-as-${projectName}-${env}`
new network.PrivateEndpoint(peName, {
    resourceGroupName: resourcesGroup.name,
    location: location,
    subnet: subnet.id,
    privateLinkServiceConnections: [{
        name: peName,
        privateLinkServiceId: storageAccount.id
    }],
    tags: tags
})